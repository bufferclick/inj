// ═══════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════
var FB = 'https://injectastar-default-rtdb.europe-west1.firebasedatabase.app';
var CLIENT_ID = '1477712531324670005';
var REDIRECT = window.location.origin + window.location.pathname;
var OWNER_ID = '1466697152062423296';
var OAUTH_URL = 'https://discord.com/api/oauth2/authorize?client_id=' + CLIENT_ID + '&redirect_uri=' + encodeURIComponent(REDIRECT) + '&response_type=token&scope=identify%20guilds';

// ═══════════════════════════════════════════════
//  APPLICATION STATE
// ═══════════════════════════════════════════════
var currentUser = null;
var currentView = 'landing';
var userGuilds = [];
var currentServerId = null;
var dashData = { files: {}, running: false };
var openFile = null;
var editorDirty = {};
var pollInterval = null;
var deleteFileTarget = null;
var deletePremiumTarget = null;
var allPremiumCache = [];
var allDashCache = {};

// ═══════════════════════════════════════════════
//  FIREBASE REST HELPERS
// ═══════════════════════════════════════════════
function fbGet(p) {
    return fetch(FB + '/' + p + '.json').then(function(r) {
        return r.json();
    }).catch(function(e) {
        console.error('FB GET error:', e);
        return null;
    });
}

function fbPut(p, d) {
    return fetch(FB + '/' + p + '.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d)
    }).then(function(r) {
        return r.json();
    }).catch(function(e) {
        console.error('FB PUT error:', e);
        return null;
    });
}

function fbPatch(p, d) {
    return fetch(FB + '/' + p + '.json', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d)
    }).then(function(r) {
        return r.json();
    }).catch(function(e) {
        console.error('FB PATCH error:', e);
        return null;
    });
}

function fbDel(p) {
    return fetch(FB + '/' + p + '.json', {
        method: 'DELETE'
    }).catch(function(e) {
        console.error('FB DEL error:', e);
    });
}

// ═══════════════════════════════════════════════
//  FIREBASE KEY ENCODING (FROM ORIGINAL)
// ═══════════════════════════════════════════════
function fKey(name) {
    return name
        .replace(/~/g, '~t')
        .replace(/\./g, '~p')
        .replace(/\$/g, '~d')
        .replace(/#/g, '~h')
        .replace(/\[/g, '~l')
        .replace(/\]/g, '~r')
        .replace(/\//g, '~s');
}

function fName(key) {
    return key
        .replace(/~s/g, '/')
        .replace(/~r/g, ']')
        .replace(/~l/g, '[')
        .replace(/~h/g, '#')
        .replace(/~d/g, '$')
        .replace(/~p/g, '.')
        .replace(/~t/g, '~');
}

function decodeFiles(obj) {
    if (!obj) return {};
    var out = {};
    for (var k in obj) {
        var n = obj[k]._name || fName(k);
        out[n] = obj[k];
    }
    return out;
}

// ═══════════════════════════════════════════════
//  DISCORD OAUTH2 (UPDATED FOR GUILDS)
// ═══════════════════════════════════════════════
function loginWithDiscord(ret) {
    if (ret) localStorage.setItem('inj_return', ret);
    window.location.href = OAUTH_URL;
}

function handleOAuth() {
    var hash = window.location.hash.substring(1);
    if (!hash) return Promise.resolve(false);
    var params = new URLSearchParams(hash);
    var token = params.get('access_token');
    if (!token) return Promise.resolve(false);

    history.replaceState(null, '', window.location.pathname);

    return Promise.all([
        fetch('https://discord.com/api/users/@me', {
            headers: { 'Authorization': 'Bearer ' + token }
        }),
        fetch('https://discord.com/api/users/@me/guilds', {
            headers: { 'Authorization': 'Bearer ' + token }
        })
    ]).then(function(responses) {
        return Promise.all([responses[0].json(), responses[1].json()]);
    }).then(function(data) {
        var user = data[0];
        var guilds = data[1];

        currentUser = {
            id: user.id,
            username: user.username,
            avatar: user.avatar,
            avatarUrl: user.avatar
                ? 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=64'
                : 'https://cdn.discordapp.com/embed/avatars/0.png'
        };

        userGuilds = guilds.filter(function(g) {
            return (g.permissions & 0x20) === 0x20 || (g.permissions & 0x8) === 0x8 || g.owner;
        });

        localStorage.setItem('inj_user', JSON.stringify(currentUser));
        localStorage.setItem('inj_guilds', JSON.stringify(userGuilds));
        return true;
    }).catch(function(e) {
        console.error('OAuth error:', e);
        return false;
    });
}

function loadSession() {
    var s = localStorage.getItem('inj_user');
    var g = localStorage.getItem('inj_guilds');
    if (s) {
        currentUser = JSON.parse(s);
        userGuilds = g ? JSON.parse(g) : [];
        return true;
    }
    return false;
}

function logout() {
    currentUser = null;
    userGuilds = [];
    currentServerId = null;
    localStorage.removeItem('inj_user');
    localStorage.removeItem('inj_guilds');
    stopPolling();
    navigateTo('landing');
    toast('Logged out', 'info');
}

function isAuth() {
    return !!currentUser;
}

function isSiteAdmin() {
    if (!currentUser) return false;
    if (currentUser.id === OWNER_ID) return true;
    return false;
}

function checkSiteAdmin() {
    if (!currentUser) return Promise.resolve(false);
    if (currentUser.id === OWNER_ID) return Promise.resolve(true);
    return fbGet('siteAdmins/' + currentUser.id).then(function(isAdmin) {
        return !!isAdmin;
    });
}

// ═══════════════════════════════════════════════
//  MOBILE NAV
// ═══════════════════════════════════════════════
function toggleMobileNav() {
    document.getElementById('mainNav').classList.toggle('nav-open');
}

function closeMobileNav() {
    document.getElementById('mainNav').classList.remove('nav-open');
}

// ═══════════════════════════════════════════════
//  NAVIGATION / VIEW SYSTEM
// ═══════════════════════════════════════════════
function navigateTo(view) {
    closeMobileNav();
    document.querySelectorAll('.view').forEach(function(v) {
        v.classList.remove('active');
    });
    currentView = view;

    if (view === 'landing') {
        document.getElementById('viewLanding').classList.add('active');
        document.body.classList.remove('app-mode');
    }
    else if (view === 'premium') {
        if (!isAuth()) { loginWithDiscord('premium'); return; }
        document.getElementById('viewPremium').classList.add('active');
        document.body.classList.add('app-mode');
        document.getElementById('premiumInput').value = '';
        document.getElementById('premiumError').style.display = 'none';
        document.getElementById('premiumSuccess').style.display = 'none';
    }
    else if (view === 'servers') {
        if (!isAuth()) { loginWithDiscord('servers'); return; }
        document.getElementById('viewServers').classList.add('active');
        document.body.classList.add('app-mode');
        loadServerSelection();
    }
    else if (view === 'admin') {
        checkSiteAdmin().then(function(isAdmin) {
            if (!isAdmin) {
                navigateTo('landing');
                toast('Access denied', 'error');
                return;
            }
            document.getElementById('viewAdmin').classList.add('active');
            document.body.classList.add('app-mode');
            switchAdminTab('overview');
        });
        return;
    }

    updateNav();
    window.scrollTo(0, 0);
}

function updateNav() {
    var els = {
        login: document.getElementById('btnNavLogin'),
        premium: document.getElementById('btnNavPremium'),
        servers: document.getElementById('btnNavServers'),
        admin: document.getElementById('btnNavAdmin'),
        logout: document.getElementById('btnNavLogout'),
        userInfo: document.getElementById('navUserInfo')
    };

    for (var k in els) {
        els[k].classList.add('nav-hidden');
    }

    document.querySelectorAll('#navCenter [data-nav="landing"]').forEach(function(li) {
        li.style.display = currentView === 'landing' ? '' : 'none';
    });

    if (isAuth()) {
        els.userInfo.classList.remove('nav-hidden');
        document.getElementById('navAvatar').src = currentUser.avatarUrl;
        document.getElementById('navUsername').textContent = currentUser.username;
        els.logout.classList.remove('nav-hidden');
        els.premium.classList.remove('nav-hidden');
        els.servers.classList.remove('nav-hidden');
        
        checkSiteAdmin().then(function(isAdmin) {
            if (isAdmin) els.admin.classList.remove('nav-hidden');
        });
    } else {
        els.login.classList.remove('nav-hidden');
    }
}

function scrollToSection(id) {
    closeMobileNav();
    if (currentView !== 'landing') {
        navigateTo('landing');
        setTimeout(function() {
            var el = document.getElementById(id);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 150);
    } else {
        var el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function handleGetStarted() {
    if (isAuth()) navigateTo('servers');
    else loginWithDiscord('servers');
}

// ═══════════════════════════════════════════════
//  CODE GENERATION
// ═══════════════════════════════════════════════
function genCode() {
    var c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var out = '';
    for (var i = 0; i < 15; i++) {
        if (i === 5 || i === 10) out += '-';
        out += c[Math.floor(Math.random() * c.length)];
    }
    return out;
}

function regeneratePremiumCode() {
    fbGet('premiumCodes').then(function(codes) {
        codes = codes || {};
        var used = {};
        for (var k in codes) used[codes[k].code] = 1;
        var code;
        var tries = 0;
        do {
            code = genCode();
            tries++;
        } while (used[code] && tries < 200);
        document.getElementById('premiumCodePreview').textContent = code;
    });
}

// ═══════════════════════════════════════════════
//  PREMIUM SYSTEM (REPLACES TICKETS)
// ═══════════════════════════════════════════════
function redeemPremium() {
    var input = document.getElementById('premiumInput');
    var errEl = document.getElementById('premiumError');
    var okEl = document.getElementById('premiumSuccess');
    var code = input.value.trim();

    errEl.style.display = 'none';
    okEl.style.display = 'none';

    if (!code) {
        errEl.textContent = 'Please enter a premium code.';
        errEl.style.display = 'block';
        return;
    }

    fbGet('premiumCodes').then(function(codes) {
        codes = codes || {};
        var fk = null;
        var fc = null;
        for (var k in codes) {
            if (codes[k].code === code) {
                fk = k;
                fc = codes[k];
                break;
            }
        }

        if (!fc) {
            errEl.textContent = 'Invalid premium code.';
            errEl.style.display = 'block';
            return;
        }

        if (fc.assignedTo && fc.assignedTo !== currentUser.id) {
            errEl.textContent = 'This code is assigned to another user.';
            errEl.style.display = 'block';
            return;
        }

        if (fc.redeemed) {
            errEl.textContent = 'This code has already been redeemed.';
            errEl.style.display = 'block';
            return;
        }

        if (fc.expiry && new Date(fc.expiry) < new Date()) {
            errEl.textContent = 'This code has expired.';
            errEl.style.display = 'block';
            return;
        }

        fbPatch('premiumCodes/' + fk, {
            redeemed: true,
            redeemedBy: currentUser.id,
            redeemedAt: Date.now()
        }).then(function() {
            return fbPut('premium/' + currentUser.id, {
                active: true,
                code: code,
                grantedAt: Date.now(),
                expiresAt: fc.expiry ? new Date(fc.expiry).getTime() : null
            });
        }).then(function() {
            okEl.textContent = 'Premium activated! You now have priority hosting.';
            okEl.style.display = 'block';
            toast('Premium activated!', 'success');
            setTimeout(function() { navigateTo('servers'); }, 1500);
        });
    });
}

// ═══════════════════════════════════════════════
//  SERVER SELECTION (NEW)
// ═══════════════════════════════════════════════
function loadServerSelection() {
    var grid = document.getElementById('serversGrid');
    grid.innerHTML = '<div class="loading-spinner">Loading your servers...</div>';

    if (userGuilds.length === 0) {
        grid.innerHTML = '<div class="empty-state"><h4>No servers found</h4><p>Make sure you have admin permissions in at least one server.</p></div>';
        return;
    }

    grid.innerHTML = userGuilds.map(function(guild) {
        var iconUrl = guild.icon 
            ? 'https://cdn.discordapp.com/icons/' + guild.id + '/' + guild.icon + '.png?size=128'
            : null;

        return '<div class="server-card" onclick="selectServer(\'' + guild.id + '\')">' +
            '<div class="server-card-header">' +
                (iconUrl 
                    ? '<img src="' + iconUrl + '" class="server-icon" alt="">'
                    : '<div class="server-icon-fallback">' + guild.name.charAt(0).toUpperCase() + '</div>') +
                '<div class="server-info">' +
                    '<div class="server-name">' + esc(guild.name) + '</div>' +
                    '<div class="server-id">' + guild.id + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="server-status available">Open Dashboard</div>' +
        '</div>';
    }).join('');
}

function selectServer(serverId) {
    currentServerId = serverId;
    
    // Close all views and open dashboard
    document.querySelectorAll('.view').forEach(function(v) {
        v.classList.remove('active');
    });
    
    document.getElementById('viewDashboard').classList.add('active');
    document.body.classList.add('app-mode');
    currentView = 'dashboard';
    updateNav();
    window.scrollTo(0, 0);
    
    loadDashboard(serverId);
}

// ═══════════════════════════════════════════════
//  DASHBOARD (CHANGED FROM USER ID TO SERVER ID)
// ═══════════════════════════════════════════════
function loadDashboard(serverId) {
    currentServerId = serverId;
    
    fbGet('dashboards/' + serverId).then(function(data) {
        if (!data) {
            var guild = userGuilds.find(function(g) { return g.id === serverId; });
            data = {
                files: {},
                running: false,
                ownerId: currentUser.id,
                ownerName: currentUser.username,
                serverName: guild ? guild.name : serverId,
                serverIcon: guild && guild.icon ? 'https://cdn.discordapp.com/icons/' + guild.id + '/' + guild.icon + '.png' : null,
                createdAt: Date.now()
            };
            fbPut('dashboards/' + serverId, data);
        }

        dashData = data;
        dashData.files = decodeFiles(data.files);
        openFile = null;
        editorDirty = {};

        document.getElementById('dashServerName').textContent = data.serverName || 'Dashboard';
        
        checkPremium().then(function(isPremium) {
            document.getElementById('dashPremiumBadge').style.display = isPremium ? '' : 'none';
        });

        renderFiles();
        syncStatus();

        if (dashData.running) startPolling();
    });
}

function checkPremium() {
    if (!currentUser) return Promise.resolve(false);
    return fbGet('premium/' + currentUser.id).then(function(premium) {
        if (!premium || !premium.active) return false;
        if (premium.expiresAt && premium.expiresAt < Date.now()) {
            fbPatch('premium/' + currentUser.id, { active: false });
            return false;
        }
        return true;
    });
}

function renderFiles() {
    var list = document.getElementById('dashFileList');
    var names = Object.keys(dashData.files).sort();
    list.innerHTML = '';

    if (names.length === 0) {
        document.getElementById('dashEmpty').style.display = 'flex';
        document.getElementById('dashEditor').classList.remove('active');
        return;
    }
    document.getElementById('dashEmpty').style.display = 'none';

    names.forEach(function(n) {
        var item = document.createElement('div');
        item.className = 'dash-file-item' + (openFile === n ? ' active' : '');
        item.innerHTML = '<span class="dash-file-name">' + esc(n) + '</span>' +
            '<button class="dash-file-delete" onclick="event.stopPropagation();promptDelFile(\'' + escA(n) + '\')" title="Delete">&times;</button>';
        item.onclick = function() { fileOpen(n); };
        list.appendChild(item);
    });
}

function fileOpen(name) {
    if (openFile && editorDirty[openFile] !== undefined) {
        dashData.files[openFile] = Object.assign({}, dashData.files[openFile] || {}, { content: editorDirty[openFile] });
    }

    openFile = name;
    var f = dashData.files[name] || {};

    document.getElementById('dashEditor').classList.add('active');
    document.getElementById('dashEmpty').style.display = 'none';

    var ta = document.getElementById('editorTextarea');
    ta.value = f.content || '';
    editorDirty[name] = ta.value;

    updateLines('editorLines', 'editorTextarea');
    renderTabs();
    renderFiles();
}

function renderTabs() {
    var c = document.getElementById('dashEditorTabs');
    c.innerHTML = '';
    if (!openFile) return;
    var tab = document.createElement('button');
    tab.className = 'dash-editor-tab active';
    tab.innerHTML = esc(openFile) + ' <span class="tab-close" onclick="event.stopPropagation();fileClose()">&times;</span>';
    c.appendChild(tab);
}

function fileClose() {
    openFile = null;
    document.getElementById('dashEditor').classList.remove('active');
    if (Object.keys(dashData.files).length === 0) {
        document.getElementById('dashEmpty').style.display = 'flex';
    }
    renderFiles();
}

function saveCurrentFile() {
    if (!openFile || !currentServerId) return;
    var content = document.getElementById('editorTextarea').value;
    var fileObj = { content: content, _name: openFile, updatedAt: Date.now() };
    dashData.files[openFile] = fileObj;
    editorDirty[openFile] = content;

    fbPut('dashboards/' + currentServerId + '/files/' + fKey(openFile), fileObj).then(function() {
        toast(openFile + ' saved', 'success');
    });
}

function openNewFileModal() {
    document.getElementById('newFileName').value = '';
    document.getElementById('newFileError').style.display = 'none';
    openModal('modalNewFile');
    setTimeout(function() { document.getElementById('newFileName').focus(); }, 100);
}

function createNewFile() {
    var nameEl = document.getElementById('newFileName');
    var errEl = document.getElementById('newFileError');
    var name = nameEl.value.trim();

    errEl.style.display = 'none';
    if (!name) {
        errEl.textContent = 'Enter a filename.';
        errEl.style.display = 'block';
        return;
    }
    if (dashData.files[name]) {
        errEl.textContent = 'File already exists.';
        errEl.style.display = 'block';
        return;
    }

    var fileObj = { content: '', _name: name, createdAt: Date.now(), updatedAt: Date.now() };
    dashData.files[name] = fileObj;

    fbPut('dashboards/' + currentServerId + '/files/' + fKey(name), fileObj).then(function() {
        closeModal('modalNewFile');
        fileOpen(name);
        toast(name + ' created', 'success');
    });
}

function promptDelFile(name) {
    deleteFileTarget = name;
    document.getElementById('deleteFileName').textContent = name;
    openModal('modalDeleteFile');
}

function confirmDeleteFile() {
    if (!deleteFileTarget || !currentServerId) return;
    var n = deleteFileTarget;
    delete dashData.files[n];
    delete editorDirty[n];

    fbDel('dashboards/' + currentServerId + '/files/' + fKey(n)).then(function() {
        if (openFile === n) fileClose();
        renderFiles();
        closeModal('modalDeleteFile');
        toast(n + ' deleted', 'info');
        deleteFileTarget = null;
    });
}

// ═══════════════════════════════════════════════
//  DASHBOARD SETTINGS
// ═══════════════════════════════════════════════
function openDashSettings() {
    loadCollaborators();
    openModal('modalDashSettings');
}

function loadCollaborators() {
    if (!currentServerId) return;
    
    fbGet('dashboards/' + currentServerId + '/collaborators').then(function(collabs) {
        var list = document.getElementById('collaboratorsList');
        
        if (!collabs || Object.keys(collabs).length === 0) {
            list.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:20px 0;">No collaborators yet.</p>';
            return;
        }

        list.innerHTML = Object.entries(collabs).map(function(e) {
            var userId = e[0];
            var data = e[1];
            return '<div class="collaborator-item">' +
                '<div class="collaborator-info">' +
                    '<div class="collaborator-name">' + esc(data.username || 'User') + '</div>' +
                    '<div class="collaborator-id">' + userId + '</div>' +
                '</div>' +
                '<button class="btn-xs btn-danger" onclick="removeCollaborator(\'' + userId + '\')">Remove</button>' +
            '</div>';
        }).join('');
    });
}

function addCollaborator() {
    var input = document.getElementById('addCollabUserId');
    var errEl = document.getElementById('addCollabError');
    var userId = input.value.trim();

    errEl.style.display = 'none';

    if (!userId) {
        errEl.textContent = 'Enter a Discord User ID.';
        errEl.style.display = 'block';
        return;
    }

    if (userId === currentUser.id) {
        errEl.textContent = 'You are already the owner.';
        errEl.style.display = 'block';
        return;
    }

    fbPut('dashboards/' + currentServerId + '/collaborators/' + userId, {
        username: 'User#' + userId.slice(-4),
        addedAt: Date.now(),
        addedBy: currentUser.id
    }).then(function() {
        input.value = '';
        toast('Collaborator added', 'success');
        loadCollaborators();
    });
}

function removeCollaborator(userId) {
    fbDel('dashboards/' + currentServerId + '/collaborators/' + userId).then(function() {
        toast('Collaborator removed', 'info');
        loadCollaborators();
    });
}

function promptDeleteDashboard() {
    var guild = userGuilds.find(function(g) { return g.id === currentServerId; });
    document.getElementById('deleteDashName').textContent = guild ? guild.name : currentServerId;
    document.getElementById('deleteDashConfirm').value = '';
    document.getElementById('deleteDashError').style.display = 'none';
    openModal('modalDeleteDashboard');
}

function confirmDeleteDashboard() {
    var input = document.getElementById('deleteDashConfirm');
    var errEl = document.getElementById('deleteDashError');

    if (input.value !== 'DELETE') {
        errEl.textContent = 'You must type DELETE to confirm.';
        errEl.style.display = 'block';
        return;
    }

    fbDel('dashboards/' + currentServerId).then(function() {
        closeModal('modalDeleteDashboard');
        closeModal('modalDashSettings');
        toast('Dashboard deleted', 'info');
        navigateTo('servers');
    });
}

// ═══════════════════════════════════════════════
//  RUN / STOP BOT
// ═══════════════════════════════════════════════
function runBot() {
    var names = Object.keys(dashData.files);
    if (names.length === 0) {
        toast('Add at least one file first.', 'error');
        return;
    }

    if (openFile) {
        var content = document.getElementById('editorTextarea').value;
        var fo = { content: content, _name: openFile, updatedAt: Date.now() };
        dashData.files[openFile] = fo;
        fbPut('dashboards/' + currentServerId + '/files/' + fKey(openFile), fo);
    }

    dashData.running = true;
    fbPatch('dashboards/' + currentServerId, { running: true, lastStarted: Date.now() });

    clearConsole();
    cLog('Syncing files to server...', 'info');
    cLog('All files uploaded successfully.', 'success');
    cLog('Starting bot process...', 'info');
    cLog('Waiting for output...', 'info');

    syncStatus();
    startPolling();
    toast('Bot starting...', 'success');
}

function stopBot() {
    dashData.running = false;
    fbPatch('dashboards/' + currentServerId, { running: false });
    cLog('Stop signal sent.', 'warn');
    cLog('Bot process terminated.', 'info');
    syncStatus();
    stopPolling();
    toast('Bot stopped', 'info');
}

function syncStatus() {
    var dot = document.getElementById('dashStatusDot');
    var text = document.getElementById('dashStatusText');
    var bRun = document.getElementById('btnRun');
    var bStp = document.getElementById('btnStop');

    if (dashData.running) {
        dot.className = 'status-dot running';
        text.textContent = 'Running';
        bRun.style.display = 'none';
        bStp.style.display = '';
    } else {
        dot.className = 'status-dot';
        text.textContent = 'Stopped';
        bRun.style.display = '';
        bStp.style.display = 'none';
    }
}

// ═══════════════════════════════════════════════
//  CONSOLE
// ═══════════════════════════════════════════════
function cLog(msg, type) {
    var body = document.getElementById('consoleBody');
    var line = document.createElement('div');
    line.className = 'console-line';
    line.innerHTML = '<span class="console-time">' + ts() + '</span><span class="console-msg ' + (type || '') + '">' + esc(msg) + '</span>';
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
}

function clearConsole() {
    document.getElementById('consoleBody').innerHTML = '';
}

function toggleConsole() {
    document.getElementById('dashConsole').classList.toggle('collapsed');
}

function startPolling() {
    stopPolling();
    pollInterval = setInterval(function() {
        fbGet('dashboards/' + currentServerId + '/consoleOutput').then(function(out) {
            if (out) {
                var body = document.getElementById('consoleBody');
                body.innerHTML = '';
                var entries = Array.isArray(out) ? out : Object.values(out);
                entries.forEach(function(e) {
                    var line = document.createElement('div');
                    line.className = 'console-line';
                    line.innerHTML = '<span class="console-time">' + esc(e.time || '--:--:--') + '</span><span class="console-msg ' + (e.type || '') + '">' + esc(e.msg || '') + '</span>';
                    body.appendChild(line);
                });
                body.scrollTop = body.scrollHeight;
            }
        });

        fbGet('dashboards/' + currentServerId + '/running').then(function(running) {
            if (running !== dashData.running) {
                dashData.running = !!running;
                syncStatus();
                if (!running) stopPolling();
            }
        });
    }, 3000);
}

function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

// ═══════════════════════════════════════════════
//  LINE NUMBERS
// ═══════════════════════════════════════════════
function updateLines(linesId, textareaId) {
    var ta = document.getElementById(textareaId);
    var ln = document.getElementById(linesId);
    var count = (ta.value.match(/\n/g) || []).length + 1;
    var html = '';
    for (var i = 1; i <= count; i++) html += i + '<br>';
    ln.innerHTML = html;
}

// ═══════════════════════════════════════════════
//  ADMIN PANEL
// ═══════════════════════════════════════════════
function switchAdminTab(tab) {
    document.querySelectorAll('.admin-nav-item').forEach(function(i) {
        i.classList.toggle('active', i.dataset.adminTab === tab);
    });
    document.querySelectorAll('.admin-tab-content').forEach(function(el) {
        el.style.display = 'none';
    });

    var map = {
        overview: 'adminTabOverview',
        premium: 'adminTabPremium',
        create: 'adminTabCreate',
        dashboards: 'adminTabDashboards',
        siteadmins: 'adminTabSiteAdmins'
    };
    var el = document.getElementById(map[tab]);
    if (el) el.style.display = '';

    if (tab === 'overview') loadOverview();
    if (tab === 'premium') loadPremiumCodes();
    if (tab === 'create') regeneratePremiumCode();
    if (tab === 'dashboards') loadDashboards();
    if (tab === 'siteadmins') loadSiteAdmins();
}

function loadOverview() {
    Promise.all([fbGet('premiumCodes'), fbGet('premium'), fbGet('dashboards'), fbGet('siteAdmins')]).then(function(res) {
        var codes = res[0] || {};
        var premium = res[1] || {};
        var dashes = res[2] || {};
        var admins = res[3] || {};

        var arr = Object.values(codes);
        document.getElementById('statTotalServers').textContent = Object.keys(dashes).length;
        document.getElementById('statPremiumUsers').textContent = Object.values(premium).filter(function(p) { return p.active; }).length;
        document.getElementById('statRunning').textContent = Object.values(dashes).filter(function(d) { return d.running; }).length;
        document.getElementById('statSiteAdmins').textContent = Object.keys(admins).length + 1;

        var sorted = Object.entries(dashes)
            .sort(function(a, b) { return (b[1].createdAt || 0) - (a[1].createdAt || 0); })
            .slice(0, 6);
        
        var container = document.getElementById('adminRecentDashboards');
        if (sorted.length === 0) {
            container.innerHTML = '<div class="empty-state"><h4>No dashboards yet</h4></div>';
            return;
        }

        container.innerHTML = sorted.map(function(e) {
            var sid = e[0];
            var d = e[1];
            var fc = d.files ? Object.keys(d.files).length : 0;
            return '<div class="admin-dash-card">' +
                '<h4>' + esc(d.serverName || sid) + '</h4>' +
                '<div class="admin-dash-meta">' +
                    '<span>Server ID: ' + sid + '</span>' +
                    '<span>Owner: ' + esc(d.ownerName || 'Unknown') + '</span>' +
                    '<span>Files: ' + fc + '</span>' +
                    '<span>Status: ' + (d.running ? '<span style="color:var(--success)">Running</span>' : 'Stopped') + '</span>' +
                '</div>' +
            '</div>';
        }).join('');
    });
}

function loadPremiumCodes() {
    fbGet('premiumCodes').then(function(codes) {
        codes = codes || {};
        allPremiumCache = Object.entries(codes)
            .sort(function(a, b) { return (b[1].createdAt || 0) - (a[1].createdAt || 0); });
        renderPremiumCards(allPremiumCache);
    });
}

function filterPremiumCodes() {
    var q = document.getElementById('premiumSearch').value.toLowerCase().trim();
    var filtered = allPremiumCache.filter(function(e) {
        var c = e[1];
        return c.code.toLowerCase().indexOf(q) !== -1 ||
            (c.assignedTo || '').indexOf(q) !== -1 ||
            (c.redeemedBy || '').indexOf(q) !== -1 ||
            (c.label || '').toLowerCase().indexOf(q) !== -1;
    });
    renderPremiumCards(filtered);
}

function renderPremiumCards(entries) {
    var container = document.getElementById('adminAllPremium');
    
    if (entries.length === 0) {
        container.innerHTML = '<div class="empty-state"><h4>No premium codes found</h4><p>Create one from the Create Code tab.</p></div>';
        return;
    }

    container.innerHTML = entries.map(function(e) {
        var key = e[0];
        var c = e[1];
        var status = c.redeemed ? 'inactive' : 'active';
        if (c.expiry && new Date(c.expiry) < new Date()) status = 'expired';

        return '<div class="ticket-card">' +
            '<div class="ticket-code">' + esc(c.code) + '</div>' +
            '<div class="ticket-meta">' +
                (c.assignedTo ? '<div class="ticket-meta-row"><span class="ticket-meta-label">Assigned To</span><span class="ticket-meta-value">' + esc(c.assignedTo) + '</span></div>' : '') +
                (c.redeemedBy ? '<div class="ticket-meta-row"><span class="ticket-meta-label">Redeemed By</span><span class="ticket-meta-value">' + esc(c.redeemedBy) + '</span></div>' : '') +
                '<div class="ticket-meta-row"><span class="ticket-meta-label">Status</span><span class="ticket-status ' + status + '">' + status + '</span></div>' +
                (c.label ? '<div class="ticket-meta-row"><span class="ticket-meta-label">Label</span><span class="ticket-meta-value">' + esc(c.label) + '</span></div>' : '') +
                (c.expiry ? '<div class="ticket-meta-row"><span class="ticket-meta-label">Expires</span><span class="ticket-meta-value">' + c.expiry + '</span></div>' : '<div class="ticket-meta-row"><span class="ticket-meta-label">Duration</span><span class="ticket-meta-value">Permanent</span></div>') +
                '<div class="ticket-meta-row"><span class="ticket-meta-label">Created</span><span class="ticket-meta-value">' + (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : 'N/A') + '</span></div>' +
            '</div>' +
            '<div class="ticket-actions">' +
                '<button class="btn-xs btn-danger" onclick="promptDelPremium(\'' + key + '\')">Delete</button>' +
            '</div>' +
        '</div>';
    }).join('');
}

function createPremiumCode() {
    var userId = document.getElementById('premiumUserId').value.trim();
    var code = document.getElementById('premiumCodePreview').textContent.trim();
    var expiry = document.getElementById('premiumExpiry').value;
    var label = document.getElementById('premiumLabel').value.trim();

    var errEl = document.getElementById('createPremiumError');
    var okEl = document.getElementById('createPremiumSuccess');
    errEl.style.display = 'none';
    okEl.style.display = 'none';

    if (!code || code === '-----') {
        errEl.textContent = 'Generate a code first.';
        errEl.style.display = 'block';
        return;
    }

    var cKey = code.replace(/-/g, '');
    fbPut('premiumCodes/' + cKey, {
        code: code,
        assignedTo: userId || null,
        expiry: expiry || null,
        label: label || null,
        redeemed: false,
        redeemedBy: null,
        createdAt: Date.now()
    }).then(function() {
        okEl.textContent = 'Premium code created: ' + code;
        okEl.style.display = 'block';
        toast('Premium code created', 'success');

        document.getElementById('premiumUserId').value = '';
        document.getElementById('premiumExpiry').value = '';
        document.getElementById('premiumLabel').value = '';
        regeneratePremiumCode();
    });
}

function promptDelPremium(key) {
    deletePremiumTarget = key;
    openModal('modalDeletePremium');
}

function confirmDeletePremium() {
    if (!deletePremiumTarget) return;
    fbDel('premiumCodes/' + deletePremiumTarget).then(function() {
        closeModal('modalDeletePremium');
        toast('Premium code deleted', 'info');
        deletePremiumTarget = null;
        loadPremiumCodes();
    });
}

function loadDashboards() {
    fbGet('dashboards').then(function(d) {
        d = d || {};
        allDashCache = d;
        renderDashCards(d);
    });
}

function filterDashboards() {
    var q = document.getElementById('dashboardSearch').value.toLowerCase().trim();
    var filtered = {};
    for (var id in allDashCache) {
        var d = allDashCache[id];
        if (id.indexOf(q) !== -1 || (d.serverName || '').toLowerCase().indexOf(q) !== -1 || (d.ownerName || '').toLowerCase().indexOf(q) !== -1) {
            filtered[id] = d;
        }
    }
    renderDashCards(filtered);
}

function renderDashCards(dashboards) {
    var container = document.getElementById('adminAllDashboards');
    var entries = Object.entries(dashboards);

    if (entries.length === 0) {
        container.innerHTML = '<div class="empty-state"><h4>No dashboards found</h4></div>';
        return;
    }

    container.innerHTML = entries.map(function(e) {
        var sid = e[0];
        var d = e[1];
        var fc = d.files ? Object.keys(d.files).length : 0;

        return '<div class="admin-dash-card">' +
            '<h4>' + esc(d.serverName || sid) + '</h4>' +
            '<div class="admin-dash-meta">' +
                '<span>Server ID: ' + sid + '</span>' +
                '<span>Owner: ' + esc(d.ownerName || 'Unknown') + ' (' + (d.ownerId || 'N/A') + ')</span>' +
                '<span>Files: ' + fc + '</span>' +
                '<span>Status: ' + (d.running ? '<span style="color:var(--success)">Running</span>' : 'Stopped') + '</span>' +
                (d.createdAt ? '<span>Created: ' + new Date(d.createdAt).toLocaleDateString() + '</span>' : '') +
            '</div>' +
            '<div class="admin-dash-actions">' +
                (d.running ? '<button class="btn-xs btn-danger" onclick="adminStopBot(\'' + sid + '\')">Shutdown</button>' : '') +
                '<button class="btn-xs btn-danger" onclick="adminDeleteDash(\'' + sid + '\')">Delete</button>' +
            '</div>' +
        '</div>';
    }).join('');
}

function adminStopBot(serverId) {
    fbPatch('dashboards/' + serverId, { running: false }).then(function() {
        toast('Bot shut down', 'info');
        loadDashboards();
    });
}

function adminDeleteDash(serverId) {
    if (!confirm('Delete this entire dashboard? This cannot be undone.')) return;
    fbDel('dashboards/' + serverId).then(function() {
        toast('Dashboard deleted', 'info');
        loadDashboards();
    });
}

function loadSiteAdmins() {
    fbGet('siteAdmins').then(function(admins) {
        admins = admins || {};
        var list = document.getElementById('siteAdminList');
        
        var html = '<div class="admin-item">' +
            '<div class="admin-item-info">' +
                '<div>' +
                    '<div class="admin-item-label">👑 You (Owner)</div>' +
                    '<div class="admin-item-id">' + OWNER_ID + '</div>' +
                '</div>' +
            '</div>' +
            '<span class="admin-owner-badge">OWNER</span>' +
        '</div>';

        for (var uid in admins) {
            html += '<div class="admin-item">' +
                '<div class="admin-item-info">' +
                    '<div>' +
                        '<div class="admin-item-label">' + (admins[uid].username || 'Admin') + '</div>' +
                        '<div class="admin-item-id">' + uid + '</div>' +
                    '</div>' +
                '</div>' +
                '<button class="btn-xs btn-danger" onclick="removeSiteAdmin(\'' + uid + '\')">Remove</button>' +
            '</div>';
        }

        list.innerHTML = html;
    });
}

function addSiteAdmin() {
    var input = document.getElementById('newAdminUserId');
    var errEl = document.getElementById('addAdminError');
    var okEl = document.getElementById('addAdminSuccess');
    var userId = input.value.trim();

    errEl.style.display = 'none';
    okEl.style.display = 'none';

    if (!userId) {
        errEl.textContent = 'Enter a Discord User ID.';
        errEl.style.display = 'block';
        return;
    }

    if (userId === OWNER_ID) {
        errEl.textContent = 'You are already the owner.';
        errEl.style.display = 'block';
        return;
    }

    fbPut('siteAdmins/' + userId, {
        username: 'Admin#' + userId.slice(-4),
        grantedAt: Date.now(),
        grantedBy: currentUser.id
    }).then(function() {
        input.value = '';
        okEl.textContent = 'Admin access granted!';
        okEl.style.display = 'block';
        toast('Admin added', 'success');
        loadSiteAdmins();
    });
}

function removeSiteAdmin(userId) {
    if (!confirm('Remove admin access for this user?')) return;
    fbDel('siteAdmins/' + userId).then(function() {
        toast('Admin removed', 'info');
        loadSiteAdmins();
    });
}

// ═══════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ═══════════════════════════════════════════════
function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}

function escA(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function ts() {
    return new Date().toTimeString().slice(0, 8);
}

function openModal(id) {
    document.getElementById(id).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function toast(msg, type) {
    var c = document.getElementById('toastContainer');
    var t = document.createElement('div');
    t.className = 'toast ' + (type || 'info');
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(function() {
        t.style.opacity = '0';
        t.style.transition = 'opacity 0.3s';
        setTimeout(function() { t.remove(); }, 300);
    }, 3500);
}

// ═══════════════════════════════════════════════
//  EVENT LISTENERS
// ═══════════════════════════════════════════════

document.getElementById('editorTextarea').addEventListener('input', function() {
    updateLines('editorLines', 'editorTextarea');
    if (openFile) editorDirty[openFile] = this.value;
});

document.getElementById('editorTextarea').addEventListener('scroll', function() {
    document.getElementById('editorLines').scrollTop = this.scrollTop;
});

document.getElementById('editorTextarea').addEventListener('keydown', function(e) {
    if (e.key === 'Tab') {
        e.preventDefault();
        var s = this.selectionStart;
        var end = this.selectionEnd;
        this.value = this.value.substring(0, s) + '    ' + this.value.substring(end);
        this.selectionStart = this.selectionEnd = s + 4;
        updateLines('editorLines', 'editorTextarea');
        if (openFile) editorDirty[openFile] = this.value;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentFile();
    }
});

document.getElementById('premiumInput').addEventListener('input', function() {
    var clean = this.value.replace(/[^a-zA-Z0-9]/g, '');
    if (clean.length > 15) clean = clean.substring(0, 15);
    var out = '';
    for (var i = 0; i < clean.length; i++) {
        if (i === 5 || i === 10) out += '-';
        out += clean[i];
    }
    this.value = out;
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(function(m) {
            m.classList.remove('active');
        });
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
    }
});

document.querySelectorAll('.modal-overlay').forEach(function(overlay) {
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.classList.remove('active');
    });
});

document.querySelectorAll('#navCenter a, #navRight .btn-nav').forEach(function(el) {
    el.addEventListener('click', function() {
        closeMobileNav();
    });
});

// ═══════════════════════════════════════════════
//  SCROLL REVEAL & CURSOR & LOADING BAR
// ═══════════════════════════════════════════════
function initEffects() {
    var glow = document.getElementById('cursorGlow');
    document.addEventListener('mousemove', function(e) {
        glow.style.left = e.clientX + 'px';
        glow.style.top = e.clientY + 'px';
    });

    function checkReveal() {
        document.querySelectorAll('.reveal').forEach(function(el) {
            if (el.getBoundingClientRect().top < window.innerHeight - 100) {
                el.classList.add('active');
            }
        });
    }
    window.addEventListener('scroll', checkReveal);
    checkReveal();

    var bar = document.getElementById('loadingBar');
    bar.style.width = '100%';
    setTimeout(function() {
        bar.style.opacity = '0';
    }, 600);

    window.addEventListener('scroll', function() {
        var max = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        if (max > 0) {
            bar.style.width = (window.scrollY / max * 100) + '%';
            bar.style.opacity = '1';
        }
    });
}

// ═══════════════════════════════════════════════
//  INITIALIZATION
// ═══════════════════════════════════════════════
function init() {
    initEffects();

    handleOAuth().then(function(oauthOk) {
        if (!oauthOk) loadSession();
        updateNav();

        if (oauthOk) {
            var ret = localStorage.getItem('inj_return') || 'servers';
            localStorage.removeItem('inj_return');
            navigateTo(ret);
        }
    });
}

init();
