class GameClient {
    constructor() {
        this.socket = null;
        this.isHost = false;
        this.roomId = null;
        this.playerId = null;
        this.playerName = 'Игрок';
        this.avatar = null; // Для кастомных аватарок
        this.defaultAvatar = '👤';
        
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
        this.setupModalListeners();
        this.setupAvatarUpload();
    }
    
    connectToServer() {
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
            this.showNotification(`${data.player.name} здарова!`, 'success');
            
            if (this.isHost) {
                this.updateAnonymousMessagePlayersList();
            }
        });
        
        // Игрок покинул комнату
        this.socket.on('player-left', (data) => {
            delete this.gameState.players[data.playerId];
            this.updatePlayersList();
            this.showNotification(`${data.playerName} покинул(а) игру`, 'warning');
            
            if (this.isHost) {
                this.updateAnonymousMessagePlayersList();
            }
        });
        
        // Вопрос показан
        this.socket.on('question-shown', (data) => {
            this.gameState.question = data.question;
            this.gameState.image = data.image;
            this.gameState.buzzerEnabled = true;
            this.gameState.activePlayer = null;
            
            this.showQuestion(data.question, data.image);
            this.updateBuzzerButton();
            this.showNotification('Появился новый вопрос!', 'success');
        });
        
        // Вопрос скрыт
        this.socket.on('question-hidden', () => {
            this.gameState.question = '';
            this.gameState.image = null;
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
            }
        });
        
        // Сброс баллов
        this.socket.on('player-score-reset', (data) => {
            if (this.gameState.players[data.playerId]) {
                this.gameState.players[data.playerId].score = 0;
                this.updatePlayersList();
                
                if (data.playerId === this.playerId && !this.isHost) {
                    document.getElementById('player-score-value').textContent = 0;
                }
            }
        });
        
        // Супер игра предложена
        this.socket.on('super-game-offered', (data) => {
            if (data.winner.id === this.playerId) {
                this.showSuperGameModal(data);
            }
            
            this.showNotification(`Супер игра! ${data.winner.name} может удвоить ${data.winner.score} баллов!`, 'warning');
        });
        
        // Детали супер игры (только для победителя)
        this.socket.on('super-game-details', (data) => {
            this.superGameDetails = data;
        });
        
        // Супер игра выиграна
        this.socket.on('super-game-success', (data) => {
            if (this.gameState.players[data.playerId]) {
                this.gameState.players[data.playerId].score = data.newScore;
                this.updatePlayersList();
                
                this.showNotification(
                    `Супер игра выиграна! ${this.gameState.players[data.playerId].name} удвоил(а) баллы! Правильный ответ: ${data.correctAnswer}`,
                    'success'
                );
            }
            
            document.getElementById('super-game-modal').style.display = 'none';
        });
        
        // Супер игра проиграна
        this.socket.on('super-game-failed', (data) => {
            this.showNotification(
                `Супер игра проиграна. Правильный ответ: ${data.correctAnswer}`,
                'error'
            );
            
            document.getElementById('super-game-modal').style.display = 'none';
        });
        
        // Игрок отказался от супер игры
        this.socket.on('super-game-declined', (data) => {
            this.showNotification('Игрок отказался от супер игры', 'info');
            document.getElementById('super-game-modal').style.display = 'none';
        });
        
        // Анонимное сообщение от ведущего
        this.socket.on('anonymous-message', (data) => {
            this.showAnonymousMessage(data.message);
        });
        
        // Обновление аватарки
        this.socket.on('avatar-updated', (data) => {
            if (this.gameState.players[data.playerId]) {
                this.gameState.players[data.playerId].avatar = data.avatar;
                this.updatePlayersList();
                
                if (data.playerId === this.playerId) {
                    this.updatePlayerAvatarDisplay(data.avatar);
                }
            }
        });
        
        // Чат
        this.socket.on('new-chat-message', (data) => {
            this.addChatMessage(data);
        });
        
        // Ошибки
        this.socket.on('buzzer-error', (data) => {
            this.showNotification(data.message, 'warning');
        });
        
        this.socket.on('super-game-error', (data) => {
            this.showNotification(data.message, 'error');
        });
    }
    
    setupEventListeners() {
        // Создание комнаты
        document.getElementById('create-room-btn').addEventListener('click', () => {
            this.playerName = document.getElementById('username').value || 'Ведущий';
            this.socket.emit('create-room', {
                name: this.playerName,
                avatar: this.avatar || this.defaultAvatar
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
                avatar: this.avatar || this.defaultAvatar
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
        
        // Изменение аватарки
        document.getElementById('change-avatar-btn').addEventListener('click', () => {
            this.showAvatarUploadModal();
        });
        
        document.getElementById('change-player-avatar-btn')?.addEventListener('click', () => {
            this.showAvatarUploadModal();
        });
        
        // Для ведущего
        document.getElementById('show-question-btn')?.addEventListener('click', () => {
            this.showQuestionToPlayers();
        });
        
        document.getElementById('hide-question-btn')?.addEventListener('click', () => {
            this.hideQuestionFromPlayers();
        });
        
        document.getElementById('remove-image-btn')?.addEventListener('click', () => {
            this.removeQuestionImage();
        });
        
        // Супер игра
        document.getElementById('start-super-game-btn')?.addEventListener('click', () => {
            this.startSuperGame();
        });
        
        document.getElementById('decline-super-game-btn')?.addEventListener('click', () => {
            this.declineSuperGame();
        });
        
        // Анонимные сообщения
        document.getElementById('send-anonymous-message-btn')?.addEventListener('click', () => {
            this.sendAnonymousMessage();
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
        
        // Загрузка картинки к вопросу
        document.getElementById('question-image-input')?.addEventListener('change', (e) => {
            this.handleQuestionImageUpload(e.target.files[0]);
        });
        
        // Покинуть комнату
        document.getElementById('leave-room-btn').addEventListener('click', () => {
            if (confirm('Покинуть комнату?')) {
                location.reload();
            }
        });
    }
    
    setupModalListeners() {
        // Закрытие анонимного сообщения
        document.getElementById('close-anonymous-message').addEventListener('click', () => {
            document.getElementById('anonymous-message-modal').style.display = 'none';
        });
        
        // Закрытие модалки загрузки аватарки
        document.getElementById('close-avatar-modal').addEventListener('click', () => {
            document.getElementById('avatar-upload-modal').style.display = 'none';
        });
        
        // Клик вне модального окна для закрытия
        window.addEventListener('click', (e) => {
            const anonymousModal = document.getElementById('anonymous-message-modal');
            const avatarModal = document.getElementById('avatar-upload-modal');
            const superGameModal = document.getElementById('super-game-modal');
            
            if (e.target === anonymousModal) {
                anonymousModal.style.display = 'none';
            }
            if (e.target === avatarModal) {
                avatarModal.style.display = 'none';
            }
            if (e.target === superGameModal) {
                superGameModal.style.display = 'none';
            }
        });
    }
    
    setupAvatarUpload() {
        const fileInput = document.getElementById('avatar-file-input');
        const selectBtn = document.getElementById('select-avatar-btn');
        const uploadBtn = document.getElementById('upload-avatar-btn');
        const preview = document.getElementById('avatar-preview');
        
        selectBtn.addEventListener('click', () => {
            fileInput.click();
        });
        
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            // Проверка размера (макс 2MB)
            if (file.size > 2 * 1024 * 1024) {
                this.showNotification('Файл слишком большой (макс. 2MB)', 'error');
                return;
            }
            
            // Проверка типа
            if (!file.type.startsWith('image/')) {
                this.showNotification('Пожалуйста, выберите изображение', 'error');
                return;
            }
            
            const reader = new FileReader();
            reader.onload = (e) => {
                // Показываем превью
                preview.innerHTML = `<img src="${e.target.result}" alt="Превью аватарки">`;
                uploadBtn.disabled = false;
                
                // Сохраняем данные для загрузки
                this.avatarData = e.target.result;
            };
            reader.readAsDataURL(file);
        });
        
        uploadBtn.addEventListener('click', () => {
            if (!this.avatarData) return;
            
            this.avatar = this.avatarData;
            
            // Обновляем отображение аватарки
            this.updateAvatarDisplay(this.avatarData);
            
            // Если мы уже в комнате, отправляем на сервер
            if (this.socket && this.socket.connected) {
                this.socket.emit('update-avatar', {
                    avatar: this.avatarData
                });
            }
            
            this.showNotification('Аватарка обновлена', 'success');
            document.getElementById('avatar-upload-modal').style.display = 'none';
        });
    }
    
    showAvatarUploadModal() {
        document.getElementById('avatar-upload-modal').style.display = 'flex';
        document.getElementById('avatar-preview').innerHTML = '<div class="default-avatar">👤</div>';
        document.getElementById('upload-avatar-btn').disabled = true;
        this.avatarData = null;
    }
    
    updateAvatarDisplay(avatarData) {
        const avatarElements = document.querySelectorAll('.avatar-img');
        avatarElements.forEach(el => {
            if (avatarData) {
                el.innerHTML = `<img src="${avatarData}" alt="Аватарка">`;
            } else {
                el.textContent = this.defaultAvatar;
            }
        });
    }
    
    updatePlayerAvatarDisplay(avatarData) {
        const playerAvatar = document.getElementById('player-avatar-large').querySelector('.avatar-img');
        if (avatarData) {
            playerAvatar.innerHTML = `<img src="${avatarData}" alt="Аватарка">`;
        } else {
            playerAvatar.textContent = this.defaultAvatar;
        }
    }
    
    showQuestionToPlayers() {
        const question = document.getElementById('question-input').value;
        if (!question.trim()) {
            this.showNotification('Введите вопрос', 'error');
            return;
        }
        
        // Получаем изображение вопроса
        const imagePreview = document.getElementById('image-preview');
        const imageData = imagePreview.style.display !== 'none' ? 
            imagePreview.querySelector('img').src : null;
        
        this.socket.emit('show-question', {
            question: question,
            image: imageData
        });
    }
    
    handleQuestionImageUpload(file) {
        if (!file) return;
        
        // Проверка размера (макс 5MB)
        if (file.size > 5 * 1024 * 1024) {
            this.showNotification('Файл слишком большой (макс. 5MB)', 'error');
            return;
        }
        
        // Проверка типа
        if (!file.type.startsWith('image/')) {
            this.showNotification('Пожалуйста, выберите изображение', 'error');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const preview = document.getElementById('image-preview');
            preview.innerHTML = `<img src="${e.target.result}" alt="Превью вопроса">`;
            preview.style.display = 'block';
            
            document.getElementById('remove-image-btn').style.display = 'inline-flex';
        };
        reader.readAsDataURL(file);
    }
    
    removeQuestionImage() {
        const preview = document.getElementById('image-preview');
        preview.innerHTML = '';
        preview.style.display = 'none';
        document.getElementById('remove-image-btn').style.display = 'none';
        document.getElementById('question-image-input').value = '';
    }
    
    hideQuestionFromPlayers() {
        this.socket.emit('hide-question');
    }
    
    adjustPlayerScore(playerId, delta) {
        this.socket.emit('adjust-player-score', {
            playerId: playerId,
            delta: delta
        });
    }
    
    resetPlayerScore(playerId) {
        this.socket.emit('reset-player-score', {
            playerId: playerId
        });
    }
    
    pressBuzzer() {
        this.socket.emit('player-buzzer');
    }
    
    startSuperGame() {
        const question = document.getElementById('super-game-question-input').value;
        const optionA = document.getElementById('option-a').value;
        const optionB = document.getElementById('option-b').value;
        const optionC = document.getElementById('option-c').value;
        const optionD = document.getElementById('option-d').value;
        const correctAnswer = document.getElementById('correct-answer-select').value;
        
        if (!question.trim() || !optionA.trim() || !correctAnswer) {
            this.showNotification('Заполните все поля для супер игры', 'error');
            return;
        }
        
        const options = {
            A: optionA,
            B: optionB,
            C: optionC,
            D: optionD,
        };
        
        this.socket.emit('start-super-game', {
            question: question,
            options: options,
            correctAnswer: correctAnswer
        });
    }
    
    declineSuperGame() {
        this.socket.emit('decline-super-game');
        document.getElementById('super-game-modal').style.display = 'none';
    }
    
    sendAnonymousMessage() {
        const playerSelect = document.getElementById('anonymous-message-player-select');
        const messageInput = document.getElementById('anonymous-message-input');
        
        const toPlayerId = playerSelect.value;
        const message = messageInput.value.trim();
        
        if (!toPlayerId || !message) {
            this.showNotification('Выберите игрока и введите сообщение', 'error');
            return;
        }
        
        this.socket.emit('send-anonymous-message', {
            toPlayerId: toPlayerId,
            message: message
        });
        
        messageInput.value = '';
        this.showNotification('Анонимное сообщение отправлено', 'success');
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
    
    showQuestion(question, image) {
        document.getElementById('question-area').classList.remove('hidden');
        document.getElementById('question-display').textContent = question;
        
        const imageDisplay = document.getElementById('question-image-display');
        imageDisplay.innerHTML = '';
        
        if (image) {
            const img = document.createElement('img');
            img.src = image;
            img.alt = 'Изображение вопроса';
            imageDisplay.appendChild(img);
        }
    }
    
    hideQuestion() {
        document.getElementById('question-display').textContent = 'Вопрос появится здесь...';
        document.getElementById('question-image-display').innerHTML = '';
    }
    
    updatePlayersList() {
        const hostList = document.getElementById('host-players-list');
        const playerList = document.getElementById('player-players-list');
        
        const list = this.isHost ? hostList : playerList;
        if (!list) return;
        
        list.innerHTML = '';
        
        Object.values(this.gameState.players).forEach(player => {
            const playerCard = this.createPlayerCard(player);
            list.appendChild(playerCard);
        });
        
        // Обновляем счетчик игроков для ведущего
        if (this.isHost) {
            document.getElementById('host-player-count').textContent = 
                Object.keys(this.gameState.players).length;
        }
    }
    
    createPlayerCard(player) {
        const playerCard = document.createElement('div');
        playerCard.className = 'player-card';
        playerCard.dataset.playerId = player.id;
        
        if (player.id === this.gameState.activePlayer) {
            playerCard.classList.add('active');
        }
        
        const isCurrentPlayer = player.id === this.playerId;
        const isHostBadge = player.isHost ? ' 👑' : '';
        const youBadge = isCurrentPlayer ? ' (Вы)' : '';
        
        // Определяем аватарку
        let avatarContent;
        if (player.avatar && player.avatar.startsWith('data:image')) {
            avatarContent = `<img src="${player.avatar}" alt="${player.name}">`;
        } else {
            avatarContent = player.avatar || this.defaultAvatar;
        }
        
        playerCard.innerHTML = `
            <div class="player-avatar-card" style="background: ${player.color}">
                ${avatarContent}
            </div>
            <div class="player-info-card">
                <div class="player-name-card">
                    ${player.name}${isHostBadge}${youBadge}
                </div>
                <div class="player-score-card ${player.score < 0 ? 'negative' : ''}">
                    ${player.score}
                </div>
                ${this.isHost && !player.isHost ? `
                    <div class="player-controls-card">
                        <button class="player-control-btn btn-plus" data-action="plus" title="+1 балл">
                            <i class="fas fa-plus"></i>
                        </button>
                        <button class="player-control-btn btn-minus" data-action="minus" title="-1 балл">
                            <i class="fas fa-minus"></i>
                        </button>
                        <button class="player-control-btn btn-reset" data-action="reset" title="Сбросить баллы">
                            <i class="fas fa-redo"></i>
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
        
        // Добавляем обработчики для кнопок управления баллами
        if (this.isHost && !player.isHost) {
            const plusBtn = playerCard.querySelector('[data-action="plus"]');
            const minusBtn = playerCard.querySelector('[data-action="minus"]');
            const resetBtn = playerCard.querySelector('[data-action="reset"]');
            
            plusBtn.addEventListener('click', () => {
                this.adjustPlayerScore(player.id, 1);
            });
            
            minusBtn.addEventListener('click', () => {
                this.adjustPlayerScore(player.id, -1);
            });
            
            resetBtn.addEventListener('click', () => {
                this.resetPlayerScore(player.id);
            });
        }
        
        return playerCard;
    }
    
    updateAnonymousMessagePlayersList() {
        if (!this.isHost) return;
        
        const select = document.getElementById('anonymous-message-player-select');
        select.innerHTML = '<option value="">Выберите игрока</option>';
        
        Object.values(this.gameState.players).forEach(player => {
            if (!player.isHost) {
                const option = document.createElement('option');
                option.value = player.id;
                option.textContent = player.name;
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
            buzzerBtn.style.animation = 'pulse-glow 2s infinite';
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
            this.updateAnonymousMessagePlayersList();
        } else {
            document.getElementById('player-panel').classList.remove('hidden');
            document.getElementById('player-room-code').textContent = this.roomId;
            document.getElementById('player-score-value').textContent = 
                this.gameState.players[this.playerId]?.score || 0;
            
            // Обновляем отображение аватарки игрока
            this.updatePlayerAvatarDisplay(this.avatar);
        }
        
        this.updatePlayersList();
        this.updateBuzzerButton();
    }
    
    showSuperGameModal(data) {
        const modal = document.getElementById('super-game-modal');
        document.getElementById('winner-name').textContent = data.winner.name;
        document.getElementById('winner-score').textContent = data.winner.score;
        document.getElementById('super-game-question-text').textContent = data.question;
        
        // Очищаем предыдущие варианты
        const optionsContainer = document.getElementById('super-game-options');
        optionsContainer.innerHTML = '';
        
        // Добавляем варианты ответов
        Object.entries(data.options).forEach(([letter, text]) => {
            if (text.trim()) {
                const optionBtn = document.createElement('button');
                optionBtn.className = 'option-btn';
                optionBtn.dataset.option = letter;
                
                optionBtn.innerHTML = `
                    <div class="option-letter">${letter}</div>
                    <div class="option-text">${text}</div>
                `;
                
                optionBtn.addEventListener('click', () => {
                    this.selectSuperGameAnswer(letter);
                });
                
                optionsContainer.appendChild(optionBtn);
            }
        });
        
        modal.style.display = 'flex';
    }
    
    selectSuperGameAnswer(answer) {
        if (!this.superGameDetails) return;
        
        this.socket.emit('super-game-answer', {
            answer: answer
        });
        
        // Блокируем кнопки после выбора
        const optionButtons = document.querySelectorAll('.option-btn');
        optionButtons.forEach(btn => {
            btn.disabled = true;
            btn.style.cursor = 'not-allowed';
            btn.style.opacity = '0.7';
        });
    }
    
    showAnonymousMessage(message) {
        const modal = document.getElementById('anonymous-message-modal');
        document.getElementById('anonymous-message-text').textContent = message;
        modal.style.display = 'flex';
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
            <div>
                <span class="sender">${data.playerName}:</span>
                <span class="message">${data.message}</span>
            </div>
            <div class="time">${time}</div>
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
            notification.style.animation = 'slideInRight 0.3s ease reverse';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

// Запуск клиента
document.addEventListener('DOMContentLoaded', () => {
    window.gameClient = new GameClient();
});

