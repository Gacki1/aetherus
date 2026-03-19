// ====== INIT ======
const myUsername = JSON.parse(document.getElementById('user_username').textContent);
const isAdmin = JSON.parse(document.getElementById('user_is_admin').textContent);
const MAX_MSG_LENGTH = 500;

// ====== STATE ======
const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
let chatSocket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;
let reconnectTimer = null;
let currentRoom = 'global';   // 'global' or group id (number)
let currentGroupId = null;    // null for global, int for groups
let currentGroupRole = null;  // 'admin' | 'member' | null

// Typing state
let typingTimeout = null;
let isTyping = false;
let typingHideTimeout = null;

// ====== WEBSOCKET ======

function getWsUrl() {
    if (currentRoom === 'global') {
        return protocol + window.location.host + '/ws/chat/';
    }
    return protocol + window.location.host + '/ws/chat/group/' + currentGroupId + '/';
}

function connectWebSocket() {
    if (chatSocket) {
        chatSocket.onclose = null; // Prevent auto-reconnect on intentional close
        chatSocket.close();
        chatSocket = null;
    }

    chatSocket = new WebSocket(getWsUrl());

    chatSocket.onopen = function() {
        reconnectAttempts = 0;
        clearTimeout(reconnectTimer);
        console.log('Chat verbunden:', currentRoom === 'global' ? 'Global' : 'Gruppe #' + currentGroupId);
    };

    chatSocket.onmessage = function(e) {
        const data = JSON.parse(e.data);

        if (data.type === 'message_deleted') {
            const el = document.getElementById('msg-' + data.message_id);
            if (el) {
                el.style.transition = 'all 0.5s ease';
                el.style.opacity = '0';
                el.style.transform = 'translateX(50px)';
                setTimeout(() => el.remove(), 500);
            }
            return;
        }

        if (data.type === 'online_count') {
            document.getElementById('online-count').textContent = data.count;
            return;
        }

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

        if (!data.message && !data.content) {
            console.log('Unbekanntes Event übersprungen:', data);
            return;
        }

        appendMessage(data);
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
            reconnectTimer = setTimeout(connectWebSocket, delay);
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

// ====== APPEND MESSAGE ======

function appendMessage(data) {
    const message = data.message || data.content || '';
    const sender = data.username || data.user || 'Unbekannt';
    const msgId = data.id || 0;
    const timestamp = data.timestamp || '';
    const avatarUrl = data.avatar_url || '';

    const isMe = (sender === myUsername);
    const messageClass = isMe ? 'sent' : 'received';
    const senderDisplay = isMe ? 'Ich' : sender;

    // Delete button: admins always, group admins in group rooms
    let deleteHtml = '';
    const canDelete = isAdmin || (currentGroupId && currentGroupRole === 'admin');
    if (canDelete) {
        deleteHtml = `<button class="delete-btn" title="Nachricht löschen" onclick="deleteMessage(${msgId})">🗑️</button>`;
    }

    const timeDisplay = timestamp ? formatTimestamp(timestamp) : '';
    const initial = sender.charAt(0).toUpperCase();
    const avatarHtml = avatarUrl
        ? `<img class="msg-avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(sender)}">`
        : `<span class="msg-avatar msg-avatar-fallback">${escapeHtml(initial)}</span>`;

    const messageElement = `
        <div id="msg-${msgId}" class="message-row ${messageClass}">
            ${!isMe ? avatarHtml : ''}
            <div class="message ${messageClass}">
                <div class="message-header">
                    <span>${escapeHtml(senderDisplay)}</span>
                    <div class="message-header-right">
                        <span class="message-time">${timeDisplay}</span>
                        ${deleteHtml}
                    </div>
                </div>
                <div class="message-body">${escapeHtml(message)}</div>
            </div>
            ${isMe ? avatarHtml : ''}
        </div>
    `;

    const chatLog = document.querySelector('#chat-log');
    chatLog.insertAdjacentHTML('beforeend', messageElement);
    chatLog.scrollTop = chatLog.scrollHeight;
}

// ====== ROOM SWITCHING ======

function switchRoom(room, groupId, groupName, groupRole) {
    if (room === currentRoom && groupId === currentGroupId) return;

    // Stop any reconnect timers
    clearTimeout(reconnectTimer);
    reconnectAttempts = 0;

    currentRoom = room;
    currentGroupId = groupId || null;
    currentGroupRole = groupRole || null;

    // Update header
    const title = document.getElementById('chat-room-title');
    title.textContent = room === 'global' ? 'Globaler Chat' : groupName;

    // Show/hide group action buttons
    const inviteWrap = document.getElementById('group-invite-btn-wrap');
    if (room !== 'global') {
        inviteWrap.style.display = 'inline-flex';
    } else {
        inviteWrap.style.display = 'none';
    }

    // Update online count visibility (only global shows it)
    document.getElementById('online-indicator').style.display =
        room === 'global' ? 'inline-flex' : 'none';

    // Highlight active room in sidebar
    document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
    const activeEl = room === 'global'
        ? document.getElementById('room-global')
        : document.getElementById('room-group-' + groupId);
    if (activeEl) activeEl.classList.add('active');

    // Clear chat log
    const chatLog = document.querySelector('#chat-log');
    chatLog.innerHTML = `<div class="chat-system-msg">--- ${room === 'global' ? 'Globaler Chat' : escapeHtml(groupName)} betreten ---</div>`;

    hideTypingIndicator();
    connectWebSocket();
}

// ====== GROUP LIST ======

function loadGroupList() {
    fetch('/api/chat/groups/', {
        credentials: 'same-origin',
    })
    .then(r => r.json())
    .then(data => {
        renderGroupList(data.groups || []);
    })
    .catch(err => {
        console.error('Fehler beim Laden der Gruppen:', err);
    });
}

function renderGroupList(groups) {
    const roomList = document.getElementById('room-list');

    // Remove old group items (keep only global)
    roomList.querySelectorAll('.room-item[data-room="group"]').forEach(el => el.remove());

    groups.forEach(group => {
        const li = document.createElement('li');
        li.className = 'room-item';
        li.id = 'room-group-' + group.id;
        li.dataset.room = 'group';
        li.dataset.groupId = group.id;
        li.dataset.groupName = group.name;
        li.dataset.groupRole = group.role;

        const icon = group.role === 'admin' ? '👑' : '💬';
        li.innerHTML = `
            <span class="room-icon">${icon}</span>
            <span class="room-name">${escapeHtml(group.name)}</span>
        `;

        li.addEventListener('click', function() {
            switchRoom('group', group.id, group.name, group.role);
            closeSidebar();
        });

        roomList.appendChild(li);
    });
}

// ====== SIDEBAR TOGGLE (mobile) ======

const sidebar = document.getElementById('chat-sidebar');
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
const sidebarCloseBtn = document.getElementById('sidebar-close-btn');

sidebarToggleBtn.addEventListener('click', function() {
    sidebar.classList.toggle('sidebar-open');
});

sidebarCloseBtn.addEventListener('click', closeSidebar);

function closeSidebar() {
    sidebar.classList.remove('sidebar-open');
}

// Click global room
document.getElementById('room-global').addEventListener('click', function() {
    switchRoom('global', null, 'Globaler Chat', null);
    closeSidebar();
});

// ====== DELETE MESSAGE ======

function deleteMessage(id) {
    if (confirm('Soll diese Nachricht wirklich für ALLE gelöscht werden?')) {
        if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
            chatSocket.send(JSON.stringify({
                'type': 'delete_message',
                'message_id': id
            }));
        }
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

    if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        if (!isTyping && len > 0) {
            isTyping = true;
            chatSocket.send(JSON.stringify({ 'type': 'typing' }));
        }
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            isTyping = false;
            if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
                chatSocket.send(JSON.stringify({ 'type': 'stop_typing' }));
            }
        }, 2000);
    }
});

function sendMessage() {
    const messageInputDom = document.querySelector('#chat-message-input');
    const message = messageInputDom.value.trim();

    if (message === '') return;
    if (message.length > MAX_MSG_LENGTH) {
        if (typeof showToast === 'function') {
            showToast(`Nachricht zu lang. Maximum: ${MAX_MSG_LENGTH} Zeichen.`, 'warning');
        }
        return;
    }

    if (!chatSocket || chatSocket.readyState !== WebSocket.OPEN) {
        if (typeof showToast === 'function') {
            showToast('Keine Verbindung. Bitte warten...', 'warning');
        }
        return;
    }

    chatSocket.send(JSON.stringify({ 'message': message }));
    messageInputDom.value = '';
    charCount.textContent = `0/${MAX_MSG_LENGTH}`;
    messageInputDom.focus();

    isTyping = false;
    clearTimeout(typingTimeout);
}

// ====== TYPING INDICATOR ======

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

// ====== CREATE GROUP MODAL ======

const createGroupBtn = document.getElementById('create-group-btn');
const createGroupModal = document.getElementById('create-group-modal');
const createModalClose = document.getElementById('create-modal-close');
const createModalCancel = document.getElementById('create-modal-cancel');
const createModalConfirm = document.getElementById('create-modal-confirm');
const groupNameInput = document.getElementById('group-name-input');

createGroupBtn.addEventListener('click', function() {
    groupNameInput.value = '';
    createGroupModal.style.display = 'flex';
    setTimeout(() => groupNameInput.focus(), 100);
});

function closeCreateModal() {
    createGroupModal.style.display = 'none';
}

createModalClose.addEventListener('click', closeCreateModal);
createModalCancel.addEventListener('click', closeCreateModal);
createGroupModal.addEventListener('click', function(e) {
    if (e.target === createGroupModal) closeCreateModal();
});

groupNameInput.addEventListener('keyup', function(e) {
    if (e.key === 'Enter') createModalConfirm.click();
});

createModalConfirm.addEventListener('click', function() {
    const name = groupNameInput.value.trim();
    if (!name) {
        if (typeof showToast === 'function') showToast('Bitte einen Gruppennamen eingeben.', 'warning');
        return;
    }

    createModalConfirm.disabled = true;
    createModalConfirm.textContent = 'Erstelle...';

    fetch('/api/chat/groups/create/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken(),
        },
        body: JSON.stringify({ name }),
        credentials: 'same-origin',
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            closeCreateModal();
            if (typeof showToast === 'function') showToast(data.message, 'success');
            loadGroupList();
            // Switch to the newly created group
            setTimeout(() => {
                switchRoom('group', data.group.id, data.group.name, 'admin');
            }, 300);
        } else {
            if (typeof showToast === 'function') showToast(data.error || 'Fehler beim Erstellen.', 'error');
        }
    })
    .catch(() => {
        if (typeof showToast === 'function') showToast('Netzwerkfehler.', 'error');
    })
    .finally(() => {
        createModalConfirm.disabled = false;
        createModalConfirm.textContent = 'Erstellen';
    });
});

// ====== INVITE MODAL ======

const inviteBtn = document.getElementById('invite-btn');
const inviteModal = document.getElementById('invite-modal');
const inviteModalClose = document.getElementById('invite-modal-close');
const inviteModalCancel = document.getElementById('invite-modal-cancel');
const inviteModalConfirm = document.getElementById('invite-modal-confirm');
const inviteUsernameInput = document.getElementById('invite-username-input');

inviteBtn.addEventListener('click', function() {
    inviteUsernameInput.value = '';
    inviteModal.style.display = 'flex';
    setTimeout(() => inviteUsernameInput.focus(), 100);
});

function closeInviteModal() {
    inviteModal.style.display = 'none';
}

inviteModalClose.addEventListener('click', closeInviteModal);
inviteModalCancel.addEventListener('click', closeInviteModal);
inviteModal.addEventListener('click', function(e) {
    if (e.target === inviteModal) closeInviteModal();
});

inviteUsernameInput.addEventListener('keyup', function(e) {
    if (e.key === 'Enter') inviteModalConfirm.click();
});

inviteModalConfirm.addEventListener('click', function() {
    const username = inviteUsernameInput.value.trim();
    if (!username) {
        if (typeof showToast === 'function') showToast('Bitte einen Benutzernamen eingeben.', 'warning');
        return;
    }
    if (!currentGroupId) return;

    inviteModalConfirm.disabled = true;
    inviteModalConfirm.textContent = 'Einlade...';

    fetch(`/api/chat/groups/${currentGroupId}/invite/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken(),
        },
        body: JSON.stringify({ username }),
        credentials: 'same-origin',
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            closeInviteModal();
            if (typeof showToast === 'function') showToast(data.message, 'success');
        } else {
            if (typeof showToast === 'function') showToast(data.error || 'Fehler beim Einladen.', 'error');
        }
    })
    .catch(() => {
        if (typeof showToast === 'function') showToast('Netzwerkfehler.', 'error');
    })
    .finally(() => {
        inviteModalConfirm.disabled = false;
        inviteModalConfirm.textContent = 'Einladen';
    });
});

// ====== LEAVE GROUP ======

document.getElementById('leave-btn').addEventListener('click', function() {
    if (!currentGroupId) return;
    const groupName = document.getElementById('chat-room-title').textContent;
    if (!confirm(`Möchtest du die Gruppe "${groupName}" wirklich verlassen?`)) return;

    fetch(`/api/chat/groups/${currentGroupId}/leave/`, {
        method: 'POST',
        headers: { 'X-CSRFToken': getCsrfToken() },
        credentials: 'same-origin',
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            if (typeof showToast === 'function') showToast(data.message, 'success');
            // Remove from sidebar and go back to global
            const el = document.getElementById('room-group-' + currentGroupId);
            if (el) el.remove();
            switchRoom('global', null, 'Globaler Chat', null);
        } else {
            if (typeof showToast === 'function') showToast(data.error || 'Fehler.', 'error');
        }
    })
    .catch(() => {
        if (typeof showToast === 'function') showToast('Netzwerkfehler.', 'error');
    });
});

// ====== HELPERS ======

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatTimestamp(isoString) {
    try {
        const date = new Date(isoString);
        const now = new Date();
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');

        if (date.toDateString() === now.toDateString()) {
            return `${hours}:${minutes}`;
        }

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return `Gestern ${hours}:${minutes}`;
        }

        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        return `${day}.${month}. ${hours}:${minutes}`;
    } catch (e) {
        return '';
    }
}

// ====== STARTUP ======

// Load group list via API (source of truth)
loadGroupList();

// Connect to global chat by default
connectWebSocket();
