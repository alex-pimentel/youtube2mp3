document.addEventListener('DOMContentLoaded', () => {

    
    const urlInput = document.getElementById('urlInput');
    const addButton = document.getElementById('addButton');
    const selectFolderButton = document.getElementById('selectFolderButton');
    const outputFolderDisplay = document.getElementById('outputFolderDisplay');
    const queueTableBody = document.getElementById('queueTableBody');
    const notificationsDiv = document.getElementById('notifications');
    const toggleDarkMode = document.getElementById('toggle-dark-mode');

    toggleDarkMode.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
    });

    let currentQueue = []; // Para manter o estado local da fila

    // Função para mostrar notificações
    function showNotification(message, type = 'info', duration = 5000) {
        const notifId = `notif-${Date.now()}`;
        const notificationElement = document.createElement('div');
        notificationElement.classList.add('notification', type);
        notificationElement.id = notifId;

        const messageSpan = document.createElement('span');
        messageSpan.textContent = message;
        notificationElement.appendChild(messageSpan);

        const closeButton = document.createElement('button');
        closeButton.classList.add('close-btn');
        closeButton.innerHTML = '&times;';
        closeButton.onclick = () => notificationElement.remove();
        notificationElement.appendChild(closeButton);

        notificationsDiv.appendChild(notificationElement);

        if (duration) {
            setTimeout(() => {
                const el = document.getElementById(notifId);
                if (el) el.remove();
            }, duration);
        }
    }

    // Carregar pasta de saída inicial
    window.electronAPI.getOutputFolder().then(folder => {
        if (folder) {
            outputFolderDisplay.textContent = `Pasta de Saída: ${folder}`;
        }
    });

    selectFolderButton.addEventListener('click', async () => {
        const folder = await window.electronAPI.selectOutputFolder();
        if (folder) {
            outputFolderDisplay.textContent = `Pasta de Saída: ${folder}`;
            showNotification(`Pasta de saída definida para: ${folder}`, 'success');
        }
    });

    addButton.addEventListener('click', () => {
        const url = urlInput.value.trim();
        if (url) {
            window.electronAPI.addToQueue(url);
            urlInput.value = ''; // Limpa o input
        } else {
            showNotification('Por favor, insira uma URL do YouTube.', 'error');
        }
    });

    urlInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            addButton.click();
        }
    });


    // Função para renderizar a fila na tabela
    function renderQueue(queue) {
        currentQueue = queue;
        queueTableBody.innerHTML = '';

        if (queue.length === 0) {
            const row = queueTableBody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 4; 
            cell.textContent = 'Nenhum vídeo na fila.';
            cell.style.textAlign = 'center';
            return;
        }

        queue.forEach(item => {
            const row = queueTableBody.insertRow();

            const titleCell = row.insertCell();
            titleCell.textContent = item.title || 'Carregando título...';
            titleCell.title = item.title;
            titleCell.style.maxWidth = '300px';
            titleCell.style.overflow = 'hidden';
            titleCell.style.textOverflow = 'ellipsis';
            titleCell.style.whiteSpace = 'nowrap';


            const statusCell = row.insertCell();
            statusCell.textContent = item.status;
            statusCell.className = `status-${item.status.replace(/\s+/g, '')}`;
            if (item.status === 'Erro' && item.error) {
                const errorText = document.createElement('div');
                errorText.textContent = `Detalhe: ${item.error.substring(0, 50)}${item.error.length > 50 ? '...' : ''}`;
                errorText.style.fontSize = '0.8em';
                errorText.style.color = '#dc3545';
                errorText.title = item.error;
                statusCell.appendChild(errorText);
            }

            const progressCell = row.insertCell();
            if (item.status === 'Baixando' || item.status === 'Convertendo' || item.status === 'Concluído') {
                 if (item.progress !== undefined) {
                    const progressContainer = document.createElement('div');
                    progressContainer.className = 'progress-bar-container';

                    const progressBar = document.createElement('div');
                    progressBar.className = 'progress-bar';
                    progressBar.style.width = `${item.progress}%`;
                    progressBar.textContent = `${item.progress}%`;
                    if (item.status === 'Convertendo') {
                        progressBar.classList.add('converting');
                    }
                    progressContainer.appendChild(progressBar);
                    progressCell.appendChild(progressContainer);
                } else {
                    progressCell.textContent = 'N/A';
                }
            } else if (item.status === 'Pendente') {
                progressCell.textContent = '0%';
            } else {
                progressCell.textContent = '---';
            }


            const actionsCell = row.insertCell();
            if (item.status === 'Concluído' && item.path) {
                const openButton = document.createElement('button');
                openButton.textContent = 'Remover';
                openButton.className = 'action-button';
                openButton.onclick = () => {
                    row.remove();
                    currentQueue = currentQueue.filter(qItem => qItem.id !== item.id);
                    showNotification(`Vídeo "${item.title}" removido da fila.`, 'success');
                }
                actionsCell.appendChild(openButton);
            }
            if (item.status === 'Erro') {
                 // Botão para tentar novamente?
            }
        });
    }

    // Ouvir atualizações da fila do processo principal
    const removeQueueUpdateListener = window.electronAPI.onQueueUpdate((updatedQueue) => {
        renderQueue(updatedQueue);
    });

    // Ouvir notificações do usuário do processo principal
    const removeNotificationListener = window.electronAPI.onUserNotification((notification) => {
        showNotification(notification.message, notification.type);
        if (notification.type === 'error' && notification.targetId) {
            // Poderia destacar o item na fila que deu erro
        }
    });

    // Limpar listeners quando a janela for descarregada (boa prática)
    window.addEventListener('beforeunload', () => {
        removeQueueUpdateListener();
        removeNotificationListener();
    });

});
