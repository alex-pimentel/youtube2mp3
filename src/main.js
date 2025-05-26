const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs'); // Não usado diretamente neste exemplo, mas útil
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');

//Get the paths to the packaged versions of the binaries we want to use
const ffmpegPath = require('ffmpeg-static').replace(
    'app.asar',
    'app.asar.unpacked'
);

//tell the ffmpeg package where it can find the needed binaries.
ffmpeg.setFfmpegPath(ffmpegPath);

try {
    ffmpeg.setFfmpegPath(ffmpegPath);
} catch (e) {
    console.warn("ffmpeg-static não encontrado ou falha ao definir o caminho. Certifique-se que ffmpeg está no PATH do sistema se não estiver empacotando.");
}

let mainWindow;
let downloadQueue = [];
let isProcessingQueue = false;
let outputDirectory = app.getPath('downloads'); // Padrão

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 700, // Aumentei um pouco para a tabela
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        // Remova o menu padrão do Electron
        autoHideMenuBar: true,
        menuBarVisible: false,
    });

    mainWindow.loadFile('src/index.html'); // Carrega o HTML diretamente
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('select-output-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Selecione a pasta para salvar os arquivos MP3'
    });
    if (!result.canceled && result.filePaths.length > 0) {
        outputDirectory = result.filePaths[0];
        return outputDirectory;
    }
    return null; // Ou o outputDirectory atual se não mudar
});

ipcMain.handle('get-output-folder', () => {
    return outputDirectory;
});

ipcMain.on('add-to-queue', async (event, url) => {
    if (!ytdl.validateURL(url)) {
        mainWindow.webContents.send('user-notification', { type: 'error', message: 'URL inválida.' });
        return;
    }
    if (!outputDirectory || !fs.existsSync(outputDirectory)) {
        mainWindow.webContents.send('user-notification', { type: 'error', message: 'Pasta de saída inválida ou não selecionada.' });
        return;
    }

    try {
        const info = await ytdl.getInfo(url);
        const videoId = uuidv4();
        const videoDetails = {
            id: videoId,
            url: url,
            title: info.videoDetails.title,
            status: 'Pendente',
            progress: 0,
            path: null,
            error: null,
        };
        downloadQueue.push(videoDetails);
        mainWindow.webContents.send('queue-update', [...downloadQueue]); // Envia a fila inteira
        processQueue();
    } catch (error) {
        console.error('Erro ao obter informações do vídeo:', error);
        mainWindow.webContents.send('user-notification', { type: 'error', message: `Erro ao buscar info: ${error.message}` });
    }
});

async function processQueue() {
    if (isProcessingQueue || downloadQueue.length === 0) {
        return;
    }

    const currentItem = downloadQueue.find(item => item.status === 'Pendente');
    if (!currentItem) {
        isProcessingQueue = false;
        return;
    }

    isProcessingQueue = true;
    updateItemStatus(currentItem.id, 'Baixando', 0);

    try {
        const videoInfo = await ytdl.getInfo(currentItem.url);
        const audioFormat = ytdl.chooseFormat(videoInfo.formats, { quality: 'highestaudio', filter: 'audioonly' });

        if (!audioFormat) {
            throw new Error('Nenhum formato de áudio adequado encontrado.');
        }

        const sanitizedTitle = currentItem.title.replace(/[\\/:*?"<>|]/g, '_').substring(0, 100);
        const finalMp3Path = path.join(outputDirectory, `${sanitizedTitle}.mp3`);
        currentItem.path = finalMp3Path; // Guarda o caminho final

        const audioStream = ytdl(currentItem.url, { format: audioFormat });

        // Acompanhamento do progresso do download (ytdl-core)
        let downloadedBytes = 0;
        let totalBytes = 0;
        audioStream.on('response', (res) => {
            totalBytes = parseInt(res.headers['content-length'], 10);
        });
        audioStream.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            if (totalBytes > 0) {
                const percentage = Math.round((downloadedBytes / totalBytes) * 100);
                // Limita a atualização para não sobrecarregar IPC
                if (percentage % 5 === 0 || percentage === 100) {
                     updateItemStatus(currentItem.id, 'Baixando', percentage);
                }
            }
        });
        audioStream.on('end', () => {
            // Garante que o progresso de download chegue a 100%
            updateItemStatus(currentItem.id, 'Baixando', 100);
        });


        await new Promise((resolve, reject) => {
            ffmpeg(audioStream)
                .audioBitrate(128)
                .toFormat('mp3')
                .on('start', () => {
                    updateItemStatus(currentItem.id, 'Convertendo', currentItem.progress); // Mantém progresso do download
                })
                .on('end', () => {
                    console.log(`Conversão concluída: ${finalMp3Path}`);
                    updateItemStatus(currentItem.id, 'Concluído', 100, finalMp3Path);
                    resolve();
                })
                .on('error', (err) => {
                    console.error(`Erro na conversão: ${err.message}`);
                    updateItemStatus(currentItem.id, 'Erro', currentItem.progress, null, `FFmpeg: ${err.message}`);
                    reject(err);
                })
                .save(finalMp3Path);
        });

    } catch (error) {
        console.error(`Erro no processamento de ${currentItem.title}:`, error);
        updateItemStatus(currentItem.id, 'Erro', currentItem.progress, null, error.message);
    } finally {
        isProcessingQueue = false;
        processQueue();
    }
}

function updateItemStatus(id, status, progress, filePath, errorMessage) {
    const itemIndex = downloadQueue.findIndex(item => item.id === id);
    if (itemIndex > -1) {
        downloadQueue[itemIndex].status = status;
        if (progress !== undefined) downloadQueue[itemIndex].progress = progress;
        if (filePath !== undefined) downloadQueue[itemIndex].path = filePath;
        if (errorMessage !== undefined) downloadQueue[itemIndex].error = errorMessage;
        else if (status !== 'Erro') downloadQueue[itemIndex].error = null; // Limpa erro anterior se não for erro

        mainWindow.webContents.send('queue-update', [...downloadQueue]); // Envia a fila inteira atualizada
    }
}