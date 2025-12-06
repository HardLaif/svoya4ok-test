class GameClient {
    constructor() {
        this.socket = null;
        this.isHost = false;
        this.roomId = null;
        this.playerId = null;
        this.playerName = 'Игрок';
        
        this.init();
    }
    
    init() {
        this.connectToServer();
        this.setupEventListeners();
    }
    
    connectToServer() {
        // Автоматическое подключение к текущему хосту (Render сам предоставит)
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
        this.socket.on('create-room-response', (data) => {
            if (data.success) {
                this.isHost = true;
                this.roomId = data.roomId;
                this.playerId = data.hostId;
                
                document.getElementById('room-code-display').textContent = data.roomId;
                document.getElementById('room-info').classList.remove('hidden');
                this.showNotification(`Комната создана! Код: ${data.roomId}`, 'success');
            } else {
                this.showNotification(`Ошибка: ${data.error}`, 'error');
            }
        });
        
        this.socket.on('join-room-response', (data) => {
            if (data.success) {
                this.isHost = false;
                this.roomId = data.roomId;
                this.playerId = data.playerId;
                
                this.switchToGameScreen();
                this.showNotification(`Вы в комнате ${data.hostName}`, 'success');
            } else {
                this.showNotification(`Ошибка: ${data.error}`, 'error');
            }
        });
        
        this.socket.on('player-joined', (data) => {
            this.showNotification(`${data.player.name} присоединился(ась)`, 'success');
        });
        
        this.socket.on('player-left', (data) => {
            this.showNotification(`${data.playerName} покинул(а) игру`, 'warning');
        });
        
        this.socket.on('room-closed', () => {
            this.showNotification('Ведущий закрыл комнату', 'warning');
            setTimeout(() => location.reload(), 3000);
        });
    }
    
    setupEventListeners() {
        document.getElementById('create-room-btn').addEventListener('click', () => {
            this.playerName = document.getElementById('username').value || 'Ведущий';
            this.socket.emit('create-room', {
                name: this.playerName,
                avatar: '👑'
            });
        });
        
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
                avatar: '👤'
            });
        });
        
        document.getElementById('copy-code-btn').addEventListener('click', () => {
            const code = document.getElementById('room-code-display').textContent;
            navigator.clipboard.writeText(code)
                .then(() => this.showNotification('Код скопирован!', 'success'))
                .catch(() => this.showNotification('Не удалось скопировать', 'error'));
        });
        
        document.getElementById('enter-room-btn').addEventListener('click', () => {
            this.switchToGameScreen();
        });
    }
    
    switchToGameScreen() {
        document.getElementById('connection-screen').classList.remove('active');
        document.getElementById('game-screen').classList.add('active');
        
        if (this.isHost) {
            document.getElementById('host-panel').classList.remove('hidden');
            document.getElementById('current-room-code').textContent = this.roomId;
        } else {
            document.getElementById('player-panel').classList.remove('hidden');
        }
    }
    
    showNotification(message, type = 'info') {
        const notifications = document.getElementById('app');
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.style.borderLeftColor = 
            type === 'success' ? '#4CAF50' : 
            type === 'error' ? '#f44336' : 
            type === 'warning' ? '#FF9800' : '#667eea';
        
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
