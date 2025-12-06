const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const GameManager = require('./game-manager');

class GameServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });
        
        this.gameManager = new GameManager();
        this.port = process.env.PORT || 3000;
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocketHandlers();
    }
    
    setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, '../public')));
        
        // Логирование запросов
        this.app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
            next();
        });
    }
    
    setupRoutes() {
        // API для проверки статуса
        this.app.get('/api/status', (req, res) => {
            res.json({
                status: 'ok',
                rooms: this.gameManager.getRoomsCount(),
                players: this.gameManager.getPlayersCount(),
                uptime: process.uptime()
            });
        });
        
        // API для получения информации о комнате
        this.app.get('/api/room/:roomId', (req, res) => {
            const room = this.gameManager.getRoom(req.params.roomId);
            if (room) {
                res.json({
                    id: room.id,
                    host: room.hostName,
                    players: Object.values(room.players).map(p => ({
                        id: p.id,
                        name: p.name,
                        score: p.score
                    })),
                    createdAt: room.createdAt
                });
            } else {
                res.status(404).json({ error: 'Комната не найдена' });
            }
        });
        
        // Главная страница
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../public/index.html'));
        });
    }
    
    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`Новое подключение: ${socket.id}`);
            
            // Создание комнаты
            socket.on('create-room', (data, callback) => {
                try {
                    const room = this.gameManager.createRoom(socket.id, data);
                    socket.join(room.id);
                    
                    // Сохраняем информацию о пользователе
                    socket.data = {
                        roomId: room.id,
                        isHost: true,
                        playerId: socket.id
                    };
                    
                    callback({
                        success: true,
                        roomId: room.id,
                        hostId: socket.id,
                        hostName: data.name || 'Ведущий'
                    });
                    
                    console.log(`Создана комната ${room.id} для ${data.name || 'Ведущий'}`);
                } catch (error) {
                    callback({ success: false, error: error.message });
                }
            });
            
            // Присоединение к комнате
            socket.on('join-room', (data, callback) => {
                try {
                    const player = this.gameManager.addPlayerToRoom(
                        data.roomId,
                        socket.id,
                        data
                    );
                    
                    socket.join(data.roomId);
                    
                    // Сохраняем информацию о пользователе
                    socket.data = {
                        roomId: data.roomId,
                        isHost: false,
                        playerId: socket.id
                    };
                    
                    const room = this.gameManager.getRoom(data.roomId);
                    
                    // Уведомляем всех в комнате о новом игроке
                    this.io.to(data.roomId).emit('player-joined', {
                        player: {
                            id: player.id,
                            name: player.name,
                            avatar: player.avatar,
                            color: player.color,
                            score: player.score
                        }
                    });
                    
                    // Отправляем текущее состояние комнаты новому игроку
                    callback({
                        success: true,
                        roomId: data.roomId,
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
                    
                    console.log(`Игрок ${data.name} присоединился к комнате ${data.roomId}`);
                } catch (error) {
                    callback({ success: false, error: error.message });
                }
            });
            
            // Ведущий показывает вопрос
            socket.on('show-question', (data) => {
                const socketData = socket.data;
                if (!socketData || !socketData.isHost) return;
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room) return;
                
                room.gameState.question = data.question;
                room.gameState.image = data.image;
                room.gameState.buzzerEnabled = true;
                
                // Рассылаем вопрос всем в комнате
                this.io.to(socketData.roomId).emit('question-shown', {
                    question: data.question,
                    image: data.image
                });
            });
            
            // Ведущий скрывает вопрос
            socket.on('hide-question', () => {
                const socketData = socket.data;
                if (!socketData || !socketData.isHost) return;
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room) return;
                
                room.gameState.question = '';
                room.gameState.buzzerEnabled = false;
                
                this.io.to(socketData.roomId).emit('question-hidden');
            });
            
            // Игрок нажимает на кнопку "Ответить"
            socket.on('player-buzzer', () => {
                const socketData = socket.data;
                if (!socketData || socketData.isHost) return;
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room || !room.gameState.buzzerEnabled) return;
                
                // Если кто-то уже ответил, игнорируем
                if (room.gameState.activePlayer) return;
                
                room.gameState.activePlayer = socket.id;
                room.gameState.buzzerEnabled = false;
                
                // Уведомляем всех о нажатии кнопки
                const player = room.players[socket.id];
                this.io.to(socketData.roomId).emit('player-buzzed', {
                    playerId: socket.id,
                    playerName: player.name
                });
            });
            
            // Ведущий добавляет/отнимает баллы
            socket.on('adjust-score', (data) => {
                const socketData = socket.data;
                if (!socketData || !socketData.isHost) return;
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room || !room.players[data.playerId]) return;
                
                const player = room.players[data.playerId];
                player.score += data.delta;
                
                // Сбрасываем активного игрока после начисления баллов
                room.gameState.activePlayer = null;
                room.gameState.buzzerEnabled = true;
                
                // Рассылаем обновленные баллы
                this.io.to(socketData.roomId).emit('score-updated', {
                    playerId: data.playerId,
                    score: player.score,
                    delta: data.delta
                });
            });
            
            // Сброс баллов игрока
            socket.on('reset-player-score', (data) => {
                const socketData = socket.data;
                if (!socketData || !socketData.isHost) return;
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room || !room.players[data.playerId]) return;
                
                room.players[data.playerId].score = 0;
                
                this.io.to(socketData.roomId).emit('player-score-reset', {
                    playerId: data.playerId
                });
            });
            
            // Начало супер игры
            socket.on('start-super-game', (data) => {
                const socketData = socket.data;
                if (!socketData || !socketData.isHost) return;
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room) return;
                
                // Определяем победителя
                let winner = null;
                let maxScore = -Infinity;
                
                for (const player of Object.values(room.players)) {
                    if (player.score > maxScore) {
                        maxScore = player.score;
                        winner = player;
                    }
                }
                
                if (!winner || maxScore <= 0) return;
                
                // Отправляем предложение супер игры
                this.io.to(socketData.roomId).emit('super-game-offered', {
                    winner: {
                        id: winner.id,
                        name: winner.name,
                        score: winner.score
                    },
                    question: data.question,
                    image: data.image
                });
            });
            
            // Результат супер игры
            socket.on('super-game-result', (data) => {
                const socketData = socket.data;
                if (!socketData || !socketData.isHost) return;
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room || !room.players[data.playerId]) return;
                
                const player = room.players[data.playerId];
                
                if (data.success) {
                    // Удваиваем баллы
                    player.score *= 2;
                    this.io.to(socketData.roomId).emit('super-game-success', {
                        playerId: data.playerId,
                        newScore: player.score
                    });
                } else {
                    // Игрок отказался или проиграл
                    this.io.to(socketData.roomId).emit('super-game-ended', {
                        playerId: data.playerId
                    });
                }
            });
            
            // Отключение игрока
            socket.on('disconnect', () => {
                const socketData = socket.data;
                if (!socketData) return;
                
                const room = this.gameManager.getRoom(socketData.roomId);
                if (!room) return;
                
                // Если отключается ведущий, закрываем комнату
                if (socketData.isHost) {
                    this.gameManager.removeRoom(socketData.roomId);
                    this.io.to(socketData.roomId).emit('room-closed');
                    console.log(`Комната ${socketData.roomId} закрыта (отключился ведущий)`);
                } else {
                    // Удаляем игрока из комнаты
                    const player = room.players[socket.id];
                    if (player) {
                        delete room.players[socket.id];
                        this.io.to(socketData.roomId).emit('player-left', {
                            playerId: socket.id,
                            playerName: player.name
                        });
                        console.log(`Игрок ${player.name} покинул комнату ${socketData.roomId}`);
                    }
                }
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
        });
    }
    
    start() {
        this.server.listen(this.port, () => {
            console.log(`🎮 Сервер "Своя игра" запущен на порту ${this.port}`);
            console.log(`🌐 Доступно по адресу: http://localhost:${this.port}`);
            console.log(`📡 WebSocket: ws://localhost:${this.port}`);
            console.log('─────────────────────────────────────');
        });
    }
}

// Запуск сервера
const gameServer = new GameServer();
gameServer.start();

// Экспорт для тестирования
module.exports = { GameServer };