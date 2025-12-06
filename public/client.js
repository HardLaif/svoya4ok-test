class GameClient {
    constructor() {
        this.socket = null;
        this.isHost = false;
        this.roomId = null;
        this.playerId = null;
        this.playerName = 'Игрок';
        this.avatar = '👨‍💼';
        
        this.gameState = {
            players: {},
            question: '',
            image: null,
            buzzerEnabled: false,
            activePlayer: null,
            superGameActive: false
        };
        
        this.selectedPlayerId = null;
        
        this.init();
    }
    
    init() {
        this.connectToServer();
        this.setupEventListeners();
        this.setupUI();
    }
    
    connectToServer() {
        // Подключаемся к серверу (автоматически определяем адрес)
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const host = window.location.hostname;
        const port = window.location.port ? `:${window.location.port}` : '';
        
        this.socket = io(`${protocol}://${host}${port}`);
        
        this.socket.on('connect', () => {
            this.showNotification('Подключено к серверу', 'success');
            this.updateServerStatus(true);
        });
        
        this.socket.on('disconnect', () => {
            this.showNotification('Отключено от сервера', 'error');
            this.updateServerStatus(false);
        });
        
        this.setupSocketListeners();
    }
    
    setupSocketListeners() {
        // Ответ на создание комнаты
        this.socket.on('create-room-response', (data) => {
            if (data.success) {
                this.isHost = true;
                this.roomId = data.roomId;
                this.playerId = data.hostId;
                
                this.updateRoomInfo(data);
                this.showNotification(`Комната создана! Код: ${data.roomId}`, 'success');
                
                // Показываем информацию о комнате
                document.getElementById('room-code-display').textContent = data.roomId;
                document.getElementById('room-info').classList.remove('hidden');
            } else {
                this.showNotification(`Ошибка: ${data.error}`, 'error');
            }
        });
        
        // Ответ на присоединение к комнате
        this.socket.on('join-room-response', (data) => {
            if (data.success) {
                this.isHost = false;
                this.roomId = data.roomId;
                this.playerId = data.playerId;
                
                // Загружаем состояние комнаты
                this.loadRoomState(data);
                this.switchToGameScreen();
                this.showNotification(`Вы присоединились к комнате ${data.hostName}`, 'success');
            } else {
                this.showNotification(`Ошибка: ${data.error}`, 'error');
            }
        });
        
        // Новый игрок присоединился
        this.socket.on('player-joined', (data) => {
            this.addPlayer(data.player);
            this.showNotification(`${data.player.name} присоединился(ась)`, 'success');
        });
        
        // Игрок покинул комнату
        this.socket.on('player-left', (data) => {
            this.removePlayer(data.playerId);
            this.showNotification(`${data.playerName} покинул(а) игру`, 'warning');
        });
        
        // Вопрос показан
        this.socket.on('question-shown', (data) => {
            this.showQuestion(data.question, data.image);
            this.showNotification('Вопрос показан всем игрокам', 'success');
        });
        
        // Вопрос скрыт
        this.socket.on('question-hidden', () => {
            this.hideQuestion();
            this.showNotification('Вопрос скрыт', 'info');
        });
        
        // Игрок нажал на кнопку
        this.socket.on('player-buzzed', (data) => {
            this.setActivePlayer(data.playerId, data.playerName);
            this.showNotification(`${data.playerName} нажал(а) на кнопку!`, 'success');
        });
        
        // Обновление баллов
        this.socket.on('score-updated', (data) => {
            this.updatePlayerScore(data.playerId, data.score, data.delta);
        });
        
        // Сброс баллов игрока
        this.socket.on('player-score-reset', (data) => {
            this.resetPlayerScore(data.playerId);
        });
        
        // Предложение супер игры
        this.socket.on('super-game-offered', (data) => {
            this.showSuperGameModal(data);
        });
        
        // Результат супер игры
        this.socket.on('super-game-success', (data) => {
            this.updatePlayerScore(data.playerId, data.newScore, 0);
            this.showNotification(`Супер игра выиграна! Баллы удвоены!`, 'success');
        });
        
        // Супер игра завершена
        this.socket.on('super-game-ended', (data) => {
            this.showNotification('Супер игра завершена', 'info');
        });
        
        // Комната закрыта
        this.socket.on('room-closed', () => {
            this.showNotification('Ведущий закрыл комнату', 'warning');
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        });
        
        // Новое сообщение в чате
        this.socket.on('new-chat-message', (data) => {
            this.addChatMessage(data);
        });
    }
    
    setupEventListeners() {
        // Создание комнаты
        document.getElementById('create-room-btn').addEventListener('click', () => {
            this.createRoom();
        });
        
        // Присоединение к комнате
        document.getElementById('join-room-btn').addEventListener('click', () => {
            this.joinRoom();
        });
        
        // Ввод комнаты по Enter
        document.getElementById('room-code').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
        
        // Копирование кода комнаты
        document.getElementById('copy-code-btn').addEventListener('click', () => {
            this.copyRoomCode();
        });
        
        // Вход в комнату после создания
        document.getElementById('enter-room-btn').addEventListener('click', () => {
            this.switchToGameScreen();
        });
        
        // Выбор аватара
        document.querySelectorAll('.avatar-option').forEach(option => {
            option.addEventListener('click', (e) => {
                document.querySelectorAll('.avatar-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                option.classList.add('selected');
                this.avatar = option.dataset.avatar;
            });
        });
        
        // Имя пользователя
        document.getElementById('username').addEventListener('input', (e) => {
            this.playerName = e.target.value || 'Игрок';
        });
        
        // Для ведущего
        this.setupHostEventListeners();
        
        // Для игрока
        this.setupPlayerEventListeners();
    }
    
    setupHostEventListeners() {
        document.getElementById('show-question-btn')?.addEventListener('click', () => {
            this.showQuestionToPlayers();
        });
        
        document.getElementById('hide-question-btn')?.addEventListener('click', () => {
            this.hideQuestionFromPlayers();
        });
        
        document.getElementById('add-point-btn')?.addEventListener('click', () => {
            this.adjustPlayerScore(1);
        });
        
        document.getElementById('subtract-point-btn')?.addEventListener('click', () => {
            this.adjustPlayerScore(-1);
        });
        
        document.getElementById('reset-player-btn')?.addEventListener('click', () => {
            this.resetSelectedPlayerScore();
        });
        
        document.getElementById('start-super-game-btn')?.addEventListener('click', () => {
            this.startSuperGame();
        });
        
        document.getElementById('end-game-btn')?.addEventListener('click', () => {
            this.endGame();
        });
        
        // Загрузка изображения
        document.getElementById('question-image-input')?.addEventListener('change', (e) => {
            this.handleImageUpload(e.target.files[0]);
        });
        
        document.getElementById('clear-image-btn')?.addEventListener('click', () => {
            this.clearImagePreview();
        });
    }
    
    setupPlayerEventListeners() {
        document.getElementById('buzzer-btn')?.addEventListener('click', () => {
            this.pressBuzzer();
        });
        
        document.getElementById('leave-room-btn')?.addEventListener('click', () => {
            this.leaveRoom();
        });
        
        document.getElementById('send-chat-btn')?.addEventListener('click', () => {
            this.sendChatMessage();
        });
        
        document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendChatMessage();
        });
    }
    
    setupUI() {
        // Инициализация UI элементов
        this.updateServerStatus(false);
    }
    
    createRoom() {
        this.playerName = document.getElementById('username').value || 'Ведущий';
        
        this.socket.emit('create-room', {
            name: this.playerName,
            avatar: this.avatar
        }, (response) => {
            // Ответ обрабатывается в socket listener
        });
    }
    
    joinRoom() {
        const roomCode = document.getElementById('room-code').value.toUpperCase();
        if (!roomCode) {
            this.showNotification('Введите код комнаты', 'error');
            return;
        }
        
        this.playerName = document.getElementById('username').value || 'Игрок';
        
        this.socket.emit('join-room', {
            roomId: roomCode,
            name: this.playerName,
            avatar: this.avatar
        }, (response) => {
            // Ответ обрабатывается в socket listener
        });
    }
    
    loadRoomState(data) {
        // Загружаем игроков
        this.gameState.players = {};
        data.players.forEach(player => {
            this.addPlayer(player);
        });
        
        // Загружаем состояние игры
        if (data.gameState) {
            this.gameState = { ...this.gameState, ...data.gameState };
            this.updateQuestionDisplay();
        }
        
        // Обновляем UI в зависимости от роли
        if (this.isHost) {
            this.setupHostUI(data.hostName);
        } else {
            this.setupPlayerUI();
        }
    }
    
    setupHostUI(hostName) {
        document.getElementById('host-name').textContent = hostName;
        document.getElementById('host-avatar').textContent = this.avatar;
        document.getElementById('current-room-code').textContent = this.roomId;
        
        document.getElementById('host-panel').style.display = 'block';
        document.getElementById('player-panel').style.display = 'none';
        
        this.updatePlayerSelect();
        this.updatePlayersCount();
    }
    
    setupPlayerUI() {
        document.getElementById('player-name').textContent = this.playerName;
        document.getElementById('player-avatar-display').textContent = this.avatar;
        document.getElementById('player-room-name').textContent = `Комната: ${this.roomId}`;
        
        document.getElementById('host-panel').style.display = 'none';
        document.getElementById('player-panel').style.display = 'block';
        
        this.updateBuzzerButton();
    }
    
    addPlayer(player) {
        this.gameState.players[player.id] = player;
        this.renderPlayers();
        
        if (this.isHost) {
            this.updatePlayerSelect();
        }
        
        this.updatePlayersCount();
    }
    
    removePlayer(playerId) {
        delete this.gameState.players[playerId];
        this.renderPlayers();
        
        if (this.isHost) {
            this.updatePlayerSelect();
        }
        
        this.updatePlayersCount();
    }
    
    renderPlayers() {
        const container = document.getElementById('players-container');
        container.innerHTML = '';
        
        Object.values(this.gameState.players).forEach(player => {
            const playerCard = document.createElement('div');
            playerCard.className = 'player-card';
            
            if (player.id === this.gameState.activePlayer) {
                playerCard.classList.add('active');
            }
            
            if (player.id === this.selectedPlayerId) {
                playerCard.classList.add('selected');
            }
            
            const isHost = player.id === Object.values(this.gameState.players).find(p => p.isHost)?.id;
            
            playerCard.innerHTML = `
                <div class="player-card-avatar" style="background: ${player.color}">
                    ${player.avatar}
                </div>
                <div class="player-card-info">
                    <div class="player-card-name">
                        ${player.name}
                        ${player.id === this.playerId ? '<span class="you-badge">(Вы)</span>' : ''}
                        ${isHost ? '<span class="host-badge">👑</span>' : ''}
                    </div>
                    <div class="player-card-score ${player.score < 0 ? 'negative' : ''}">
                        ${player.score}
                    </div>
                </div>
            `;
            
            if (this.isHost) {
                playerCard.addEventListener('click', () => {
                    this.selectPlayer(player.id);
                });
            }
            
            container.appendChild(playerCard);
        });
    }
    
    selectPlayer(playerId) {
        this.selectedPlayerId = playerId;
        document.getElementById('player-select').value = playerId;
        this.renderPlayers();
        
        // Показываем информацию об активном игроке
        if (playerId === this.gameState.activePlayer) {
            const player = this.gameState.players[playerId];
            const activePlayerInfo = document.getElementById('active-player-info');
            activePlayerInfo.innerHTML = `
                <strong>${player.name}</strong> нажал(а) на кнопку и готов(а) отвечать!
            `;
            activePlayerInfo.style.display = 'block';
        }
    }
    
    updatePlayerSelect() {
        const select = document.getElementById('player-select');
        if (!select) return;
        
        select.innerHTML = '<option value="">Выберите игрока</option>';
        
        Object.values(this.gameState.players).forEach(player => {
            if (player.id === this.playerId) return; // Не показываем ведущего в списке
            
            const option = document.createElement('option');
            option.value = player.id;
            option.textContent = `${player.name} (${player.score})`;
            select.appendChild(option);
        });
    }
    
    showQuestionToPlayers() {
        const question = document.getElementById('question-input').value;
        if (!question.trim()) {
            this.showNotification('Введите вопрос', 'error');
            return;
        }
        
        const image = document.getElementById('image-preview').querySelector('img');
        const imageData = image ? image.src : null;
        
        this.socket.emit('show-question', {
            question: question,
            image: imageData
        });
    }
    
    hideQuestionFromPlayers() {
        this.socket.emit('hide-question');
    }
    
    adjustPlayerScore(delta) {
        if (!this.selectedPlayerId) {
            this.showNotification('Выберите игрока', 'error');
            return;
        }
        
        this.socket.emit('adjust-score', {
            playerId: this.selectedPlayerId,
            delta: delta
        });
    }
    
    resetSelectedPlayerScore() {
        if (!this.selectedPlayerId) {
            this.showNotification('Выберите игрока', 'error');
            return;
        }
        
        this.socket.emit('reset-player-score', {
            playerId: this.selectedPlayerId
        });
    }
    
    pressBuzzer() {
        if (!this.gameState.buzzerEnabled) {
            this.showNotification('Сейчас нельзя отвечать', 'warning');
            return;
        }
        
        this.socket.emit('player-buzzer');
        document.getElementById('buzzer-btn').disabled = true;
    }
    
    sendChatMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        
        if (!message) return;
        
        this.socket.emit('send-chat-message', {
            message: message
        });
        
        input.value = '';
    }
    
    addChatMessage(data) {
        const container = document.getElementById('chat-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        
        const time = new Date(data.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        messageDiv.innerHTML = `
            <span class="sender">${data.playerName}:</span>
            <span class="message">${data.message}</span>
            <div class="time">${time}</div>
        `;
        
        container.appendChild(messageDiv);
        container.scrollTop = container.scrollHeight;
    }
    
    showQuestion(question, image) {
        this.gameState.question = question;
        this.gameState.image = image;
        this.gameState.buzzerEnabled = true;
        
        this.updateQuestionDisplay();
        this.updateBuzzerButton();
        
        if (!this.isHost) {
            this.showNotification('Появился новый вопрос!', 'success');
        }
    }
    
    hideQuestion() {
        this.gameState.question = '';
        this.gameState.image = null;
        this.gameState.buzzerEnabled = false;
        
        this.updateQuestionDisplay();
        this.updateBuzzerButton();
    }
    
    setActivePlayer(playerId, playerName) {
        this.gameState.activePlayer = playerId;
        this.gameState.buzzerEnabled = false;
        
        this.renderPlayers();
        this.updateBuzzerButton();
        
        if (this.isHost) {
            const activePlayerInfo = document.getElementById('active-player-info');
            activePlayerInfo.innerHTML = `
                <strong>${playerName}</strong> нажал(а) на кнопку и готов(а) отвечать!
                Вы можете начислить или снять баллы.
            `;
            activePlayerInfo.style.display = 'block';
            
            // Автоматически выбираем этого игрока
            this.selectPlayer(playerId);
        }
    }
    
    updatePlayerScore(playerId, score, delta) {
        if (this.gameState.players[playerId]) {
            this.gameState.players[playerId].score = score;
            
            // Показываем уведомление об изменении баллов
            if (delta !== 0) {
                const player = this.gameState.players[playerId];
                const type = delta > 0 ? 'success' : 'error';
                this.showNotification(`${player.name}: ${delta > 0 ? '+' : ''}${delta}`, type);
            }
            
            this.renderPlayers();
            
            if (this.isHost) {
                this.updatePlayerSelect();
            }
            
            // Обновляем собственный счет, если это мы
            if (playerId === this.playerId) {
                document.getElementById('player-score-value').textContent = score;
            }
        }
    }
    
    resetPlayerScore(playerId) {
        if (this.gameState.players[playerId]) {
            this.gameState.players[playerId].score = 0;
            this.renderPlayers();
            
            if (this.isHost) {
                this.updatePlayerSelect();
            }
            
            this.showNotification('Баллы игрока сброшены', 'warning');
        }
    }
    
    startSuperGame() {
        const question = document.getElementById('super-game-question').value;
        if (!question.trim()) {
            this.showNotification('Введите вопрос для супер игры', 'error');
            return;
        }
        
        this.socket.emit('start-super-game', {
            question: question
        });
    }
    
    showSuperGameModal(data) {
        const modal = document.getElementById('super-game-modal');
        document.getElementById('winner-name').textContent = data.winner.name;
        document.getElementById('winner-score').textContent = data.winner.score;
        document.getElementById('winner-avatar').textContent = '👑';
        document.getElementById('super-game-question-display').textContent = data.question;
        
        if (data.image) {
            const img = document.createElement('img');
            img.src = data.image;
            document.getElementById('super-game-image').innerHTML = '';
            document.getElementById('super-game-image').appendChild(img);
        }
        
        // Настройка кнопок
        document.getElementById('accept-super-game-btn').onclick = () => {
            this.socket.emit('super-game-result', {
                playerId: data.winner.id,
                success: true
            });
            modal.style.display = 'none';
        };
        
        document.getElementById('decline-super-game-btn').onclick = () => {
            this.socket.emit('super-game-result', {
                playerId: data.winner.id,
                success: false
            });
            modal.style.display = 'none';
        };
        
        modal.style.display = 'flex';
    }
    
    updateQuestionDisplay() {
        const questionDisplay = document.getElementById('question-display');
        const imageDisplay = document.getElementById('question-image-display');
        
        if (this.gameState.question) {
            questionDisplay.textContent = this.gameState.question;
        } else {
            questionDisplay.textContent = 'Вопрос появится здесь...';
        }
        
        imageDisplay.innerHTML = '';
        if (this.gameState.image) {
            const img = document.createElement('img');
            img.src = this.gameState.image;
            imageDisplay.appendChild(img);
        }
    }
    
    updateBuzzerButton() {
        const buzzerBtn = document.getElementById('buzzer-btn');
        const buzzerStatus = document.getElementById('buzzer-status');
        
        if (!buzzerBtn || !buzzerStatus) return;
        
        if (this.gameState.buzzerEnabled) {
            buzzerBtn.disabled = false;
            buzzerStatus.textContent = 'Готов к ответу! Нажмите кнопку, если знаете ответ';
        } else {
            buzzerBtn.disabled = true;
            if (this.gameState.activePlayer === this.playerId) {
                buzzerStatus.textContent = 'Вы отвечаете! Ожидайте оценки ведущего';
            } else if (this.gameState.activePlayer) {
                buzzerStatus.textContent = 'Другой игрок отвечает...';
            } else {
                buzzerStatus.textContent = 'Ждите, когда ведущий покажет вопрос';
            }
        }
    }
    
    updatePlayersCount() {
        const count = Object.keys(this.gameState.players).length;
        document.getElementById('players-count').textContent = `${count}/6`;
        
        if (this.isHost) {
            document.getElementById('host-players-count').textContent = `${count} игроков`;
        }
    }
    
    updateServerStatus(connected) {
        const statusElement = document.querySelector('.status-indicator');
        if (!statusElement) return;
        
        if (connected) {
            statusElement.classList.add('connected');
            statusElement.classList.remove('disconnected');
            statusElement.innerHTML = `
                <div class="status-dot"></div>
                <span>Сервер подключен</span>
            `;
        } else {
            statusElement.classList.remove('connected');
            statusElement.classList.add('disconnected');
            statusElement.innerHTML = `
                <div class="status-dot"></div>
                <span>Сервер отключен</span>
            `;
        }
    }
    
    updateRoomInfo(data) {
        document.getElementById('room-code-display').textContent = data.roomId;
    }
    
    switchToGameScreen() {
        document.getElementById('connection-screen').classList.remove('active');
        document.getElementById('game-screen').classList.add('active');
        
        if (this.isHost) {
            this.setupHostUI(this.playerName);
        } else {
            this.setupPlayerUI();
        }
        
        this.renderPlayers();
        this.updateQuestionDisplay();
    }
    
    copyRoomCode() {
        const code = document.getElementById('room-code-display').textContent;
        navigator.clipboard.writeText(code)
            .then(() => this.showNotification('Код скопирован!', 'success'))
            .catch(() => this.showNotification('Не удалось скопировать код', 'error'));
    }
    
    handleImageUpload(file) {
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const preview = document.getElementById('image-preview');
            preview.innerHTML = `<img src="${e.target.result}" alt="Превью">`;
            preview.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
    
    clearImagePreview() {
        const preview = document.getElementById('image-preview');
        preview.innerHTML = '';
        preview.style.display = 'none';
    }
    
    endGame() {
        if (confirm('Завершить игру для всех участников?')) {
            window.location.reload();
        }
    }
    
    leaveRoom() {
        if (confirm('Покинуть комнату?')) {
            window.location.reload();
        }
    }
    
    showNotification(message, type = 'info') {
        const notifications = document.getElementById('notifications');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${
                    type === 'success' ? 'check-circle' : 
                    type === 'error' ? 'exclamation-circle' : 
                    type === 'warning' ? 'exclamation-triangle' : 'info-circle'
                }"></i>
                <span>${message}</span>
            </div>
        `;
        
        notifications.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

// Запуск клиента при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    window.gameClient = new GameClient();
});