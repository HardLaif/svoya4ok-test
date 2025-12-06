const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');

class GameServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        
        this.io = socketIo(this.server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            },
            transports: ['websocket', 'polling']
        });
        
        this.gameManager = new GameManager();
        this.port = process.env.PORT || 3000;
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocketHandlers();
    }
    
    setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.static(path.join(__dirname, 'public')));
        
        this.app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
            next();
        });
    }
    
    setupRoutes() {
        this.app.get('/api/status', (req, res) => {
            res.json({
                status: 'ok',
                message: 'Игра "Своя игра" работает',
                timestamp: new Date().toISOString()
            });
        });
        
        this.app.get('*', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });
    }
    
    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`Новый пользователь: ${socket.id}`);
            
            // Создание комнаты
            socket.on('create-room', (data) => {
                try {
                    const room = this.gameManager.createRoom(socket.id, data);
                    socket.join(room.id);
                    
                    socket.data = {
                        roomId: room.id,
                        isHost: true,
                        playerId: socket.id
                    };
                    
                    socket.emit('create-room-response', {
                        success: true,
                        roomId: room.id,
                        hostId: socket.id,
                        hostName: data.name || 'Ведущий'
                    });
                    
                    console.log(`Создана комната ${room.id}`);
                } catch (error) {
                    socket.emit('create-room-response', {
                        success: false,
                        error: error.message
                    });
                }
            });
            
            // Присоединение к комнате
            socket.on('join-room', (data) => {
                try {
                    const roomId = data.roomId.toUpperCase();
                    const player = this.gameManager.addPlayerToRoom(
                        roomId,
                        socket.id,
                        data
                    );
                    
                    socket.join(roomId);
                    socket.data = {
                        roomId: roomId,
                        isHost: false,
                        playerId: socket.id
                    };
                    
                    const room = this.gameManager.getRoom(roomId);
                    
                    // Уведомляем всех о новом игроке
                    this.io.to(roomId).emit('player-joined', {
                        player: {
                            id: player.id,
                            name: player.name,
                            avatar: player.avatar,
                            color: player.color,
                            score: player.score
                        }
                    });
                    
                    // Отправляем состояние комнаты новому игроку
                    socket.emit('join-room-response', {
                        success: true,
                        roomId: roomId,
                        playerId: socket.id,
                        hostName: room.hostName,
                        players: Object.values(room.players).map(p => ({
                            id: p.id,
                            name: p.name,
                            avatar: p.avatar,
                            color: p.color,
                            score: p.score
                        })),
                        gameState: room.gameState
                    });
                    
                    console.log(`Игрок ${player.name} в комнате ${roomId}`);
                } catch (error) {
                    socket.emit('join-room-response', {
                        success: false,
                        error: error.message
                    });
                }
            });
            
            // Ведущий показывает вопрос
            socket.on('show-question', (data) => {
                const socketData = socket.data;
                if (!socketData?.isHost) return;
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room) return;
                
                room.gameState.question = data.question;
                room.gameState.image = data.image;
                room.gameState.buzzerEnabled = true;
                room.gameState.activePlayer = null;
                
                this.io.to(socketData.roomId).emit('question-shown', {
                    question: data.question,
                    image: data.image
                });
                
                socket.emit('show-question-response', { success: true });
            });
            
            // Ведущий скрывает вопрос
            socket.on('hide-question', () => {
                const socketData = socket.data;
                if (!socketData?.isHost) return;
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room) return;
                
                room.gameState.question = '';
                room.gameState.image = null;
                room.gameState.buzzerEnabled = false;
                room.gameState.activePlayer = null;
                
                this.io.to(socketData.roomId).emit('question-hidden');
                socket.emit('hide-question-response', { success: true });
            });
            
            // Игрок нажимает на кнопку
            socket.on('player-buzzer', () => {
                const socketData = socket.data;
                if (!socketData || socketData.isHost) return;
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room || !room.gameState.buzzerEnabled || room.gameState.activePlayer) {
                    socket.emit('buzzer-error', { message: 'Невозможно ответить сейчас' });
                    return;
                }
                
                room.gameState.activePlayer = socket.id;
                room.gameState.buzzerEnabled = false;
                
                const player = room.players[socket.id];
                this.io.to(socketData.roomId).emit('player-buzzed', {
                    playerId: socket.id,
                    playerName: player.name
                });
                
                socket.emit('buzzer-success', { message: 'Вы нажали на кнопку!' });
            });
            
            // Изменение баллов игрока (новый формат)
            socket.on('adjust-player-score', (data) => {
                const socketData = socket.data;
                if (!socketData?.isHost) {
                    socket.emit('adjust-score-error', { message: 'Только ведущий может менять баллы' });
                    return;
                }
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room || !room.players[data.playerId]) {
                    socket.emit('adjust-score-error', { message: 'Игрок не найден' });
                    return;
                }
                
                const player = room.players[data.playerId];
                player.score += data.delta;
                room.gameState.activePlayer = null;
                room.gameState.buzzerEnabled = true;
                
                this.io.to(socketData.roomId).emit('score-updated', {
                    playerId: data.playerId,
                    score: player.score,
                    delta: data.delta
                });
            });
            
            // Сброс баллов игрока
            socket.on('reset-player-score', (data) => {
                const socketData = socket.data;
                if (!socketData?.isHost) {
                    socket.emit('reset-score-error', { message: 'Только ведущий может сбрасывать баллы' });
                    return;
                }
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room || !room.players[data.playerId]) {
                    socket.emit('reset-score-error', { message: 'Игрок не найден' });
                    return;
                }
                
                room.players[data.playerId].score = 0;
                room.gameState.activePlayer = null;
                room.gameState.buzzerEnabled = true;
                
                this.io.to(socketData.roomId).emit('player-score-reset', {
                    playerId: data.playerId
                });
            });
            
            // Запуск супер игры
            socket.on('start-super-game', (data) => {
                const socketData = socket.data;
                if (!socketData?.isHost) {
                    socket.emit('super-game-error', { message: 'Только ведущий может начать супер игру' });
                    return;
                }
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room) {
                    socket.emit('super-game-error', { message: 'Комната не найдена' });
                    return;
                }
                
                // Находим победителя
                let winner = null;
                let maxScore = -Infinity;
                
                for (const player of Object.values(room.players)) {
                    if (!player.isHost && player.score > maxScore) {
                        maxScore = player.score;
                        winner = player;
                    }
                }
                
                if (!winner || maxScore <= 0) {
                    socket.emit('super-game-error', { message: 'Нет подходящего победителя' });
                    return;
                }
                
                // Сохраняем данные супер игры
                room.gameState.superGame = {
                    active: true,
                    question: data.question,
                    options: data.options,
                    correctAnswer: data.correctAnswer,
                    winnerId: winner.id,
                    winnerName: winner.name,
                    currentScore: winner.score
                };
                
                // Отправляем предложение супер игры всем
                this.io.to(socketData.roomId).emit('super-game-offered', {
                    winner: {
                        id: winner.id,
                        name: winner.name,
                        score: winner.score
                    },
                    question: data.question,
                    options: data.options
                });
                
                // Отправляем подробности только победителю
                this.io.to(winner.id).emit('super-game-details', {
                    options: data.options,
                    correctAnswer: data.correctAnswer
                });
                
                socket.emit('start-super-game-response', { success: true });
            });
            
            // Игрок выбирает ответ в супер игре
            socket.on('super-game-answer', (data) => {
                const socketData = socket.data;
                if (!socketData) return;
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room || !room.gameState.superGame?.active) return;
                
                // Проверяем, что отвечает правильный игрок
                if (socket.id !== room.gameState.superGame.winnerId) return;
                
                const isCorrect = data.answer === room.gameState.superGame.correctAnswer;
                
                if (isCorrect) {
                    // Удваиваем баллы
                    room.players[socket.id].score *= 2;
                    
                    this.io.to(socketData.roomId).emit('super-game-success', {
                        playerId: socket.id,
                        newScore: room.players[socket.id].score,
                        correctAnswer: room.gameState.superGame.correctAnswer
                    });
                } else {
                    this.io.to(socketData.roomId).emit('super-game-failed', {
                        playerId: socket.id,
                        correctAnswer: room.gameState.superGame.correctAnswer
                    });
                }
                
                // Завершаем супер игру
                room.gameState.superGame.active = false;
            });
            
            // Игрок отказывается от супер игры
            socket.on('decline-super-game', () => {
                const socketData = socket.data;
                if (!socketData) return;
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room || !room.gameState.superGame?.active) return;
                
                if (socket.id !== room.gameState.superGame.winnerId) return;
                
                this.io.to(socketData.roomId).emit('super-game-declined', {
                    playerId: socket.id
                });
                
                room.gameState.superGame.active = false;
            });
            
            // Ведущий отправляет анонимное сообщение игроку
            socket.on('send-anonymous-message', (data) => {
                const socketData = socket.data;
                if (!socketData?.isHost) return;
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room || !room.players[data.toPlayerId]) return;
                
                // Отправляем сообщение только указанному игроку
                this.io.to(data.toPlayerId).emit('anonymous-message', {
                    message: data.message,
                    fromHost: true
                });
            });
            
            // Обновление аватарки
            socket.on('update-avatar', (data) => {
                const socketData = socket.data;
                if (!socketData) return;
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room || !room.players[socket.id]) return;
                
                room.players[socket.id].avatar = data.avatar;
                
                // Уведомляем всех об обновлении аватарки
                this.io.to(socketData.roomId).emit('avatar-updated', {
                    playerId: socket.id,
                    avatar: data.avatar
                });
            });
            
            // Чат
            socket.on('send-chat-message', (data) => {
                const socketData = socket.data;
                if (!socketData) return;
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room) return;
                
                const player = room.players[socket.id];
                if (!player) return;
                
                this.io.to(socketData.roomId).emit('new-chat-message', {
                    playerId: socket.id,
                    playerName: player.name,
                    message: data.message,
                    timestamp: Date.now()
                });
            });
            
            // Отключение
            socket.on('disconnect', () => {
                const socketData = socket.data;
                if (!socketData) return;
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room) return;
                
                if (socketData.isHost) {
                    this.gameManager.removeRoom(socketData.roomId);
                    this.io.to(socketData.roomId).emit('room-closed');
                    console.log(`Комната ${socketData.roomId} закрыта`);
                } else {
                    const player = room.players[socket.id];
                    if (player) {
                        delete room.players[socket.id];
                        this.io.to(socketData.roomId).emit('player-left', {
                            playerId: socket.id,
                            playerName: player.name
                        });
                    }
                }
            });
        });
    }
    
    start() {
        this.server.listen(this.port, () => {
            console.log(`=====================================`);
            console.log(`🎮 "Своя игра" с расширенными возможностями запущена!`);
            console.log(`📍 Порт: ${this.port}`);
            console.log(`=====================================`);
        });
    }
}

// Менеджер игры
class GameManager {
    constructor() {
        this.rooms = new Map();
        this.MAX_PLAYERS = 6;
    }
    
    createRoom(hostId, hostData) {
        const roomId = this.generateRoomId();
        const room = {
            id: roomId,
            hostId: hostId,
            hostName: hostData.name || 'Ведущий',
            players: {},
            gameState: {
                question: '',
                image: null,
                buzzerEnabled: false,
                activePlayer: null,
                superGame: null
            },
            createdAt: Date.now()
        };
        
        room.players[hostId] = {
            id: hostId,
            name: hostData.name || 'Ведущий',
            avatar: hostData.avatar || '👑',
            color: this.getRandomColor(),
            score: 0,
            isHost: true
        };
        
        this.rooms.set(roomId, room);
        return room;
    }
    
    addPlayerToRoom(roomId, playerId, playerData) {
        const room = this.rooms.get(roomId);
        if (!room) throw new Error('Комната не найдена');
        
        if (Object.keys(room.players).length >= this.MAX_PLAYERS) {
            throw new Error('В комнате уже максимальное количество игроков');
        }
        
        if (room.players[playerId]) {
            throw new Error('Игрок уже в комнате');
        }
        
        const player = {
            id: playerId,
            name: playerData.name || `Игрок ${Object.keys(room.players).length}`,
            avatar: playerData.avatar || '👤',
            color: this.getRandomColor(),
            score: 0,
            isHost: false
        };
        
        room.players[playerId] = player;
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
        
        if (this.rooms.has(result)) {
            return this.generateRoomId();
        }
        
        return result;
    }
    
    getRandomColor() {
        const colors = [
            '#667eea', '#764ba2', '#4CAF50', '#FF9800',
            '#f44336', '#2196F3', '#9C27B0', '#009688'
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }
}

// Запуск сервера
const gameServer = new GameServer();
gameServer.start();

module.exports = { GameServer };
