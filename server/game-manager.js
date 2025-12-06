class GameManager {
    constructor() {
        this.rooms = new Map();
        this.MAX_PLAYERS = 6;
        this.ROOM_EXPIRY = 24 * 60 * 60 * 1000; // 24 часа
    }
    
    createRoom(hostId, hostData) {
        const roomId = this.generateRoomId();
        
        const room = {
            id: roomId,
            hostId: hostId,
            hostName: hostData.name || 'Ведущий',
            hostAvatar: hostData.avatar,
            players: {},
            gameState: {
                question: '',
                image: null,
                buzzerEnabled: false,
                activePlayer: null,
                superGameActive: false
            },
            createdAt: Date.now(),
            lastActivity: Date.now()
        };
        
        // Добавляем ведущего как игрока
        room.players[hostId] = {
            id: hostId,
            name: hostData.name || 'Ведущий',
            avatar: hostData.avatar,
            color: this.getRandomColor(),
            score: 0,
            isHost: true,
            joinedAt: Date.now()
        };
        
        this.rooms.set(roomId, room);
        
        // Очистка старых комнат
        this.cleanupOldRooms();
        
        return room;
    }
    
    addPlayerToRoom(roomId, playerId, playerData) {
        const room = this.rooms.get(roomId);
        
        if (!room) {
            throw new Error('Комната не найдена');
        }
        
        if (Object.keys(room.players).length >= this.MAX_PLAYERS) {
            throw new Error('В комнате уже максимальное количество игроков');
        }
        
        if (room.players[playerId]) {
            throw new Error('Игрок уже в комнате');
        }
        
        const player = {
            id: playerId,
            name: playerData.name || `Игрок ${Object.keys(room.players).length}`,
            avatar: playerData.avatar,
            color: this.getRandomColor(),
            score: 0,
            isHost: false,
            joinedAt: Date.now()
        };
        
        room.players[playerId] = player;
        room.lastActivity = Date.now();
        
        return player;
    }
    
    getRoom(roomId) {
        return this.rooms.get(roomId);
    }
    
    removeRoom(roomId) {
        return this.rooms.delete(roomId);
    }
    
    generateRoomId() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        // Проверяем уникальность
        if (this.rooms.has(result)) {
            return this.generateRoomId();
        }
        
        return result;
    }
    
    getRandomColor() {
        const colors = [
            '#667eea', '#764ba2', '#4CAF50', '#FF9800',
            '#f44336', '#2196F3', '#9C27B0', '#009688',
            '#FF5722', '#795548', '#607D8B'
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }
    
    cleanupOldRooms() {
        const now = Date.now();
        for (const [roomId, room] of this.rooms.entries()) {
            if (now - room.lastActivity > this.ROOM_EXPIRY) {
                this.rooms.delete(roomId);
                console.log(`Удалена старая комната: ${roomId}`);
            }
        }
    }
    
    getRoomsCount() {
        return this.rooms.size;
    }
    
    getPlayersCount() {
        let count = 0;
        for (const room of this.rooms.values()) {
            count += Object.keys(room.players).length;
        }
        return count;
    }
}

module.exports = GameManager;