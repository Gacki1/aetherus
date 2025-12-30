// 1. Daten aus Django holen
const myUsername = JSON.parse(document.getElementById('user_username').textContent);
const isAdmin = JSON.parse(document.getElementById('user_is_admin').textContent);

// 2. WebSocket URL automatisch bestimmen
const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const wsUrl = protocol + window.location.host + '/ws/chat/';

console.log("Verbinde zu:", wsUrl);
const chatSocket = new WebSocket(wsUrl);

// --- WENN NACHRICHTEN ANKOMMEN ---
chatSocket.onmessage = function (e) {
    const data = JSON.parse(e.data);

    // FALL A: Nachricht gelöscht
    if (data.type === 'message_deleted') {
        const msgId = data.message_id;
        const elementToRemove = document.getElementById('msg-' + msgId);

        if (elementToRemove) {
            elementToRemove.style.transition = "all 0.5s ease";
            elementToRemove.style.opacity = "0";
            elementToRemove.style.transform = "translateX(50px)";
            setTimeout(() => { elementToRemove.remove(); }, 500);
        }
        return;
    }

    // FALL B: Neue Nachricht
    const message = data.message;
    const sender = data.username;
    const msgId = data.id;

    const isMe = (sender === myUsername);
    const messageClass = isMe ? 'sent' : 'received';
    const senderDisplay = isMe ? 'Ich' : sender;

    let deleteHtml = '';
    if (isAdmin) {
        deleteHtml = `<button class="delete-btn" title="Nachricht löschen" onclick="deleteMessage(${msgId})">🗑️</button>`;
    }

    const messageElement = `
            <div id="msg-${msgId}" class="message ${messageClass}">
                <div class="message-header">
                    <span>${senderDisplay}</span>
                    ${deleteHtml}
                </div>
                <div class="message-body">${message}</div>
            </div>
        `;

    const chatLog = document.querySelector('#chat-log');
    chatLog.insertAdjacentHTML('beforeend', messageElement);
    chatLog.scrollTop = chatLog.scrollHeight;
};

// --- FUNKTION: Nachricht löschen ---
function deleteMessage(id) {
    if (confirm("Soll diese Nachricht wirklich für ALLE gelöscht werden?")) {
        chatSocket.send(JSON.stringify({
            'type': 'delete_message',
            'message_id': id
        }));
    }
}

// --- VERBINDUNG VERLOREN ---
chatSocket.onclose = function (e) {
    console.error('Chat Socket geschlossen.');
    const chatLog = document.querySelector('#chat-log');
    chatLog.insertAdjacentHTML('beforeend',
        `<div style="text-align:center; color:#ff4d4d; margin-top:10px; font-weight:bold;">
                ⚠️ Verbindung unterbrochen. Bitte Seite neu laden.
             </div>`
    );
};

// --- ABSENDEN ---
document.querySelector('#chat-message-submit').onclick = function (e) { sendMessage(); };

document.querySelector('#chat-message-input').onkeyup = function (e) {
    if (e.key === 'Enter') sendMessage();
};

function sendMessage() {
    const messageInputDom = document.querySelector('#chat-message-input');
    const message = messageInputDom.value;

    if (message.trim() !== "") {
        chatSocket.send(JSON.stringify({ 'message': message }));
        messageInputDom.value = '';
        messageInputDom.focus();
    }
}