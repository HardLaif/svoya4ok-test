class GameClient {
    constructor() {
        this.socket = null;
        this.isHost = false;
        this.roomId = null;
        this.playerId = null;
        this.playerName = 'Игрок';
        this.avatar = '👤';
        
        this.gameState = {
            players: {},
            question: '',
            buzzerEnabled: false,
            activePlayer: null
        };
        
        this.init();
    }
    
    init() {
        this.connectToServer();
        this.setupEventListeners();
        this.setupAvatarSelection();
    }
    
    connectToServer() {
        // Подключаемся к текущему хосту (Render сам предоставит)
        this.socket = io({
            transports: ['websocket', 'polling']
        });
        
        this.socket.on('connect', () => {
            this.showNotification('Подключено к серверу', 'success');
            console.log('✅ Подключено к серверу');
        });
        
        this.socket.on('disconnect', () => {
            this.showNotification('Соединение потеряно', 'error');
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
                this.playerName = document.getElementById('username').value || 'Ведущий';
                
                document.getElementById('room-code-display').textContent = data.roomId;
                document.getElementById('room-info').classList.remove('hidden');
                this.showNotification(`Комната создана! Код: ${data.roomId}`, 'success');
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
                this.playerName = document.getElementById('username').value || 'Игрок';
                
                // Загружаем состояние комнаты
                data.players.forEach(player => {
                    this.gameState.players[player.id] = player;
                });
                
                this.switchToGameScreen();
                this.showNotification(`Вы в комнате ${data.hostName}`, 'success');
                this.updatePlayersList();
            } else {
                this.showNotification(`Ошибка: ${data.error}`, 'error');
            }
        });
        
        // Новый игрок присоединился
        this.socket.on('player-joined', (data) => {
            this.gameState.players[data.player.id] = data.player;
            this.updatePlayersList();
            this.showNotification(`${data.player.name} присоединился(ась)`, 'success');
        });
        
        // Игрок покинул комнату
        this.socket.on('player-left', (data) => {
            delete this.gameState.players[data.playerId];
            this.updatePlayersList();
            this.showNotification(`${data.playerName} покинул(а) игру`, 'warning');
        });
        
        // Вопрос показан
        this.socket.on('question-shown', (data) => {
            this.gameState.question = data.question;
            this.gameState.buzzerEnabled = true;
            this.gameState.activePlayer = null;
            
            this.showQuestion(data.question);
            this.updateBuzzerButton();
            this.showNotification('Появился новый вопрос!', 'success');
        });
        
        // Вопрос скрыт
        this.socket.on('question-hidden', () => {
            this.gameState.question = '';
            this.gameState.buzzerEnabled = false;
            this.gameState.activePlayer = null;
            
            this.hideQuestion();
            this.updateBuzzerButton();
            this.showNotification('Вопрос скрыт', 'info');
        });
        
        // Игрок нажал на кнопку
        this.socket.on('player-buzzed', (data) => {
            this.gameState.activePlayer = data.playerId;
            this.gameState.buzzerEnabled = false;
            
            this.updatePlayersList();
            this.updateBuzzerButton();
            
            if (this.isHost) {
                this.showNotification(`${data.playerName} нажал(а) на кнопку!`, 'success');
                this.selectPlayer(data.playerId);
            }
        });
        
        // Обновление баллов
        this.socket.on('score-updated', (data) => {
            if (this.gameState.players[data.playerId]) {
                this.gameState.players[data.playerId].score = data.score;
                this.updatePlayersList();
                
                if (data.playerId === this.playerId && !this.isHost) {
                    document.getElementById('player-score-value').textContent = data.score;
                }
                
                if (data.delta !== 0) {
                    const player = this.gameState.players[data.playerId];
                    const type = data.delta > 0 ? 'success' : 'error';
                    this.showNotification(`${player.name}: ${data.delta > 0 ? '+' : ''}${data.delta}`, type);
                }
            }
        });
        
        // Сброс баллов
        this.socket.on('player-score-reset', (data) => {
            if (this.gameState.players[data.playerId]) {
                this.gameState.players[data.playerId].score = 0;
                this.updatePlayersList();
                this.showNotification('Баллы игрока сброшены', 'warning');
            }
        });
        
        // Супер игра
        this.socket.on('super-game-offered', (data) => {
            this.showSuperGameModal(data);
        });
        
        this.socket.on('super-game-success', (data) => {
            if (this.gameState.players[data.playerId]) {
                this.gameState.players[data.playerId].score = data.newScore;
                this.updatePlayersList();
                this.showNotification('Супер игра выиграна! Баллы удвоены!', 'success');
            }
        });
        
        this.socket.on('super-game-ended', () => {
            this.showNotification('Супер игра завершена', 'info');
        });
        
        // Чат
        this.socket.on('new-chat-message', (data) => {
            this.addChatMessage(data);
        });
        
        // Ошибки
        this.socket.on('buzzer-error', (data) => {
            this.showNotification(data.message, 'warning');
        });
        
        this.socket.on('adjust-score-error', (data) => {
            this.showNotification(data.message, 'error');
        });
        
        this.socket.on('reset-score-error', (data) => {
            this.showNotification(data.message, 'error');
        });
        
        this.socket.on('super-game-error', (data) => {
            this.showNotification(data.message, 'error');
        });
        
        // Ответы на действия
        this.socket.on('show-question-response', () => {
            this.showNotification('Вопрос отправлен игрокам', 'success');
        });
        
        this.socket.on('hide-question-response', () => {
            this.showNotification('Вопрос скрыт', 'info');
        });
        
        this.socket.on('adjust-score-response', () => {
            // Опционально: можно показать подтверждение
        });
        
        this.socket.on('reset-score-response', () => {
            // Опционально: можно показать подтверждение
        });
        
        this.socket.on('start-super-game-response', () => {
            this.showNotification('Супер игра началась!', 'success');
        });
        
        // Комната закрыта
        this.socket.on('room-closed', () => {
            this.showNotification('Ведущий закрыл комнату', 'warning');
            setTimeout(() => {
                location.reload();
            }, 3000);
        });
    }
    
    setupEventListeners() {
        // Создание комнаты
        document.getElementById('create-room-btn').addEventListener('click', () => {
            this.playerName = document.getElementById('username').value || 'Ведущий';
            this.socket.emit('create-room', {
                name: this.playerName,
                avatar: this.avatar
            });
        });
        
        // Присоединение к комнате
        document.getElementById('join-room-btn').addEventListener('click', () => {
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
            });
        });
        
        // Ввод комнаты по Enter
        document.getElementById('room-code').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
        
        // Копирование кода
        document.getElementById('copy-code-btn').addEventListener('click', () => {
            const code = document.getElementById('room-code-display').textContent;
            navigator.clipboard.writeText(code)
                .then(() => this.showNotification('Код скопирован!', 'success'))
                .catch(() => this.showNotification('Не удалось скопировать', 'error'));
        });
        
        // Вход в комнату
        document.getElementById('enter-room-btn').addEventListener('click', () => {
            this.switchToGameScreen();
        });
        
        // Для ведущего
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
        
        // Для игрока
        document.getElementById('buzzer-btn')?.addEventListener('click', () => {
            this.pressBuzzer();
        });
        
        // Чат
        document.getElementById('send-chat-btn')?.addEventListener('click', () => {
            this.sendChatMessage();
        });
        
        document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendChatMessage();
        });
        
        // Покинуть комнату
        document.getElementById('leave-room-btn').addEventListener('click', () => {
            if (confirm('Покинуть комнату?')) {
                location.reload();
            }
        });
    }
    
    setupAvatarSelection() {
        document.querySelectorAll('.avatar-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.avatar-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                option.classList.add('selected');
                this.avatar = option.dataset.avatar;
            });
        });
    }
    
    showQuestionToPlayers() {
        const question = document.getElementById('question-input').value;
        if (!question.trim()) {
            this.showNotification('Введите вопрос', 'error');
            return;
        }
        
        this.socket.emit('show-question', {
            question: question,
            image: null
        });
    }
    
    hideQuestionFromPlayers() {
        this.socket.emit('hide-question');
    }
    
    adjustPlayerScore(delta) {
        const playerSelect = document.getElementById('player-select');
        const playerId = playerSelect.value;
        
        if (!playerId) {
            this.showNotification('Выберите игрока', 'error');
            return;
        }
        
        this.socket.emit('adjust-score', {
            playerId: playerId,
            delta: delta
        });
    }
    
    resetSelectedPlayerScore() {
        const playerSelect = document.getElementById('player-select');
        const playerId = playerSelect.value;
        
        if (!playerId) {
            this.showNotification('Выберите игрока', 'error');
            return;
        }
        
        this.socket.emit('reset-player-score', {
            playerId: playerId
        });
    }
    
    pressBuzzer() {
        this.socket.emit('player-buzzer');
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
    
    showQuestion(question) {
        document.getElementById('question-area').classList.remove('hidden');
        document.getElementById('question-display').textContent = question;
    }
    
    hideQuestion() {
        document.getElementById('question-display').textContent = 'Вопрос появится здесь...';
    }
    
    updatePlayersList() {
        const hostList = document.getElementById('host-players-list');
        const playerList = document.getElementById('player-players-list');
        
        if (!hostList && !playerList) return;
        
        const list = this.isHost ? hostList : playerList;
        if (!list) return;
        
        list.innerHTML = '';
        
        Object.values(this.gameState.players).forEach(player => {
            const playerItem = document.createElement('div');
            playerItem.className = 'player-item';
            
            if (player.id === this.gameState.activePlayer) {
                playerItem.classList.add('active');
            }
            
            if (this.isHost && player.id === this.selectedPlayerId) {
                playerItem.style.borderColor = '#667eea';
                playerItem.style.boxShadow = '0 0 0 2px #667eea';
            }
            
            const isCurrentPlayer = player.id === this.playerId;
            const isHostBadge = player.isHost ? ' 👑' : '';
            const youBadge = isCurrentPlayer ? ' (Вы)' : '';
            
            playerItem.innerHTML = `
                <div class="player-avatar" style="background: ${player.color}">
                    ${player.avatar}
                </div>
                <div class="player-info">
                    <div class="player-name">
                        ${player.name}${isHostBadge}${youBadge}
                    </div>
                    <div class="player-score ${player.score < 0 ? 'negative' : ''}">
                        ${player.score}
                    </div>
                </div>
            `;
            
            if (this.isHost && !player.isHost) {
                playerItem.addEventListener('click', () => {
                    this.selectPlayer(player.id);
                });
                playerItem.style.cursor = 'pointer';
            }
            
            list.appendChild(playerItem);
        });
        
        // Обновляем счетчик игроков для ведущего
        if (this.isHost) {
            document.getElementById('host-player-count').textContent = 
                Object.keys(this.gameState.players).length;
        }
        
        // Обновляем выпадающий список для ведущего
        if (this.isHost) {
            this.updatePlayerSelect();
        }
    }
    
    selectPlayer(playerId) {
        this.selectedPlayerId = playerId;
        const select = document.getElementById('player-select');
        if (select) {
            select.value = playerId;
        }
        this.updatePlayersList();
    }
    
    updatePlayerSelect() {
        const select = document.getElementById('player-select');
        if (!select) return;
        
        select.innerHTML = '<option value="">Выберите игрока</option>';
        
        Object.values(this.gameState.players).forEach(player => {
            if (!player.isHost) {
                const option = document.createElement('option');
                option.value = player.id;
                option.textContent = `${player.name} (${player.score})`;
                select.appendChild(option);
            }
        });
    }
    
    updateBuzzerButton() {
        const buzzerBtn = document.getElementById('buzzer-btn');
        const buzzerStatus = document.getElementById('buzzer-status');
        
        if (!buzzerBtn || !buzzerStatus) return;
        
        if (this.gameState.buzzerEnabled) {
            buzzerBtn.disabled = false;
            buzzerBtn.style.animation = 'pulse 2s infinite';
            buzzerStatus.textContent = 'Готов к ответу! Нажмите кнопку, если знаете ответ';
        } else {
            buzzerBtn.disabled = true;
            buzzerBtn.style.animation = 'none';
            
            if (this.gameState.activePlayer === this.playerId) {
                buzzerStatus.textContent = 'Вы отвечаете! Ожидайте оценки ведущего';
            } else if (this.gameState.activePlayer) {
                buzzerStatus.textContent = 'Другой игрок отвечает...';
            } else {
                buzzerStatus.textContent = 'Ждите, когда ведущий покажет вопрос';
            }
        }
    }
    
    switchToGameScreen() {
        document.getElementById('connection-screen').classList.remove('active');
        document.getElementById('game-screen').classList.add('active');
        
        if (this.isHost) {
            document.getElementById('host-panel').classList.remove('hidden');
            document.getElementById('current-room-code').textContent = this.roomId;
            document.getElementById('question-area').classList.remove('hidden');
            document.getElementById('chat-container').classList.remove('hidden');
        } else {
            document.getElementById('player-panel').classList.remove('hidden');
            document.getElementById('player-room-code').textContent = this.roomId;
            document.getElementById('chat-container').classList.remove('hidden');
            document.getElementById('player-score-value').textContent = 
                this.gameState.players[this.playerId]?.score || 0;
        }
        
        this.updatePlayersList();
        this.updateBuzzerButton();
    }
    
    showSuperGameModal(data) {
        // Простая реализация модального окна
        if (confirm(`Супер игра! ${data.winner.name}, вы хотите удвоить свои ${data.winner.score} баллов?\n\nВопрос: ${data.question}`)) {
            this.socket.emit('super-game-result', {
                playerId: data.winner.id,
                success: true
            });
        } else {
            this.socket.emit('super-game-result', {
                playerId: data.winner.id,
                success: false
            });
        }
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
            <div class="time" style="font-size: 0.8rem; color: #94a3b8;">${time}</div>
        `;
        
        container.appendChild(messageDiv);
        container.scrollTop = container.scrollHeight;
    }
    
    showNotification(message, type = 'info') {
        const notifications = document.getElementById('notifications');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
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

// Запуск клиента
document.addEventListener('DOMContentLoaded', () => {
    window.gameClient = new GameClient();
});
