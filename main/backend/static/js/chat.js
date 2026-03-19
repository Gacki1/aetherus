// ====== INIT ======
const myUsername = JSON.parse(document.getElementById('user_username').textContent);
const isAdmin = JSON.parse(document.getElementById('user_is_admin').textContent);
const MAX_MSG_LENGTH = 500;

// ====== WebSocket ======
const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const wsUrl = protocol + window.location.host + '/ws/chat/';
let chatSocket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;

// Typing state
let typingTimeout = null;
let isTyping = false;

function connectWebSocket() {
    chatSocket = new WebSocket(wsUrl);

    chatSocket.onopen = function() {
        reconnectAttempts = 0;
        console.log("Chat verbunden.");
    };

    chatSocket.onmessage = function(e) {
        const data = JSON.parse(e.data);

        // Message deleted
        if (data.type === 'message_deleted') {
            const el = document.getElementById('msg-' + data.message_id);
            if (el) {
                el.style.transition = "all 0.5s ease";
                el.style.opacity = "0";
                el.style.transform = "translateX(50px)";
                setTimeout(() => el.remove(), 500);
            }
            return;
        }

        // Online count update
        if (data.type === 'online_count') {
            document.getElementById('online-count').textContent = data.count;
            return;
        }

        // Typing indicator
        if (data.type === 'typing') {
            if (data.username !== myUsername) {
                showTypingIndicator(data.username);
            }
            return;
        }

        if (data.type === 'stop_typing') {
            hideTypingIndicator();
            return;
        }

        // Skip unknown event types without message data
        if (!data.message && !data.content) {
            console.log('Skipping unknown event:', data);
            return;
        }

        // New message
        const message = data.message || data.content || '';
        const sender = data.username || data.user || 'Unbekannt';
        const msgId = data.id || 0;
        const timestamp = data.timestamp || '';

        const isMe = (sender === myUsername);
        const messageClass = isMe ? 'sent' : 'received';
        const senderDisplay = isMe ? 'Ich' : sender;

        let deleteHtml = '';
        if (isAdmin) {
            deleteHtml = `<button class="delete-btn" title="Nachricht löschen" onclick="deleteMessage(${msgId})">🗑️</button>`;
        }

        const timeDisplay = timestamp ? formatTimestamp(timestamp) : '';

        const messageElement = `
            <div id="msg-${msgId}" class="message ${messageClass}">
                <div class="message-header">
                    <span>${escapeHtml(senderDisplay)}</span>
                    <div class="message-header-right">
                        <span class="message-time">${timeDisplay}</span>
                        ${deleteHtml}
                    </div>
                </div>
                <div class="message-body">${escapeHtml(message)}</div>
            </div>
        `;

        const chatLog = document.querySelector('#chat-log');
        chatLog.insertAdjacentHTML('beforeend', messageElement);
        chatLog.scrollTop = chatLog.scrollHeight;

        // Hide typing indicator when message arrives
        hideTypingIndicator();
    };

    chatSocket.onclose = function(e) {
        console.error('Chat Socket geschlossen.');

        if (reconnectAttempts < MAX_RECONNECT) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
            const chatLog = document.querySelector('#chat-log');
            chatLog.insertAdjacentHTML('beforeend',
                `<div class="chat-system-msg chat-system-warn">
                    ⚠️ Verbindung unterbrochen. Reconnect in ${Math.round(delay / 1000)}s...
                </div>`
            );
            setTimeout(connectWebSocket, delay);
        } else {
            const chatLog = document.querySelector('#chat-log');
            chatLog.insertAdjacentHTML('beforeend',
                `<div class="chat-system-msg chat-system-error">
                    ⚠️ Verbindung verloren. Bitte Seite neu laden.
                </div>`
            );
        }
    };

    chatSocket.onerror = function(e) {
        console.error('WebSocket Fehler:', e);
    };
}

connectWebSocket();

// ====== DELETE MESSAGE ======
function deleteMessage(id) {
    if (confirm("Soll diese Nachricht wirklich für ALLE gelöscht werden?")) {
        chatSocket.send(JSON.stringify({
            'type': 'delete_message',
            'message_id': id
        }));
    }
}

// ====== SEND MESSAGE ======
document.querySelector('#chat-message-submit').onclick = function() { sendMessage(); };

document.querySelector('#chat-message-input').onkeyup = function(e) {
    if (e.key === 'Enter') sendMessage();
};

// Character counter
const messageInput = document.querySelector('#chat-message-input');
const charCount = document.getElementById('char-count');

messageInput.addEventListener('input', function() {
    const len = this.value.length;
    charCount.textContent = `${len}/${MAX_MSG_LENGTH}`;
    charCount.style.color = len > MAX_MSG_LENGTH * 0.9 ? '#ff4d4d' : '#555';

    // Send typing indicator
    if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        if (!isTyping && len > 0) {
            isTyping = true;
            chatSocket.send(JSON.stringify({ 'type': 'typing' }));
        }
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            isTyping = false;
            chatSocket.send(JSON.stringify({ 'type': 'stop_typing' }));
        }, 2000);
    }
});

function sendMessage() {
    const messageInputDom = document.querySelector('#chat-message-input');
    const message = messageInputDom.value.trim();

    if (message === "") return;
    if (message.length > MAX_MSG_LENGTH) {
        if (typeof showToast === 'function') {
            showToast(`Nachricht zu lang. Maximum: ${MAX_MSG_LENGTH} Zeichen.`, 'warning');
        }
        return;
    }

    chatSocket.send(JSON.stringify({ 'message': message }));
    messageInputDom.value = '';
    charCount.textContent = `0/${MAX_MSG_LENGTH}`;
    messageInputDom.focus();

    // Stop typing indicator
    isTyping = false;
    clearTimeout(typingTimeout);
}

// ====== TYPING INDICATOR ======
let typingHideTimeout = null;

function showTypingIndicator(username) {
    const indicator = document.getElementById('typing-indicator');
    const text = document.getElementById('typing-text');
    text.textContent = `${username} tippt`;
    indicator.style.display = 'flex';

    clearTimeout(typingHideTimeout);
    typingHideTimeout = setTimeout(hideTypingIndicator, 4000);
}

function hideTypingIndicator() {
    document.getElementById('typing-indicator').style.display = 'none';
    clearTimeout(typingHideTimeout);
}

// ====== HELPERS ======
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatTimestamp(isoString) {
    try {
        const date = new Date(isoString);
        const now = new Date();
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');

        // Check if same day
        if (date.toDateString() === now.toDateString()) {
            return `${hours}:${minutes}`;
        }

        // Check if yesterday
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return `Gestern ${hours}:${minutes}`;
        }

        // Otherwise show date
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        return `${day}.${month}. ${hours}:${minutes}`;
    } catch (e) {
        return '';
    }
}
