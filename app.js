var FB='https://injectastar-default-rtdb.europe-west1.firebasedatabase.app';
var CLIENT_ID='1477712531324670005';
var REDIRECT=window.location.origin+window.location.pathname;
var ADMIN_ID='1466697152062423296';
var OAUTH_URL='https://discord.com/api/oauth2/authorize?client_id='+CLIENT_ID+'&redirect_uri='+encodeURIComponent(REDIRECT)+'&response_type=token&scope=identify';

var currentUser=null;
var currentView='landing';
var dashData={files:{},running:false};
var openFile=null;
var editorDirty={};
var pollInterval=null;
var deleteFileTarget=null;
var deleteTicketTarget=null;
var viewerUserId=null;
var viewerData={files:{}};
var viewerOpenFile=null;
var allTicketCache=[];
var allDashCache={};

function fbGet(p){return fetch(FB+'/'+p+'.json').then(function(r){return r.json()}).catch(function(){return null})}
function fbPut(p,d){return fetch(FB+'/'+p+'.json',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json()}).catch(function(){return null})}
function fbPatch(p,d){return fetch(FB+'/'+p+'.json',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json()}).catch(function(){return null})}
function fbDel(p){return fetch(FB+'/'+p+'.json',{method:'DELETE'}).catch(function(){})}

function fKey(n){return n.replace(/~/g,'~t').replace(/\./g,'~p').replace(/\$/g,'~d').replace(/#/g,'~h').replace(/\[/g,'~l').replace(/\]/g,'~r').replace(/\//g,'~s')}
function fName(k){return k.replace(/~s/g,'/').replace(/~r/g,']').replace(/~l/g,'[').replace(/~h/g,'#').replace(/~d/g,'$').replace(/~p/g,'.').replace(/~t/g,'~')}

function decodeFiles(obj){
    if(!obj)return {};
    var out={};
    for(var k in obj){out[obj[k]._name||fName(k)]=obj[k]}
    return out;
}

function loginWithDiscord(ret){
    if(ret)localStorage.setItem('inj_return',ret);
    window.location.href=OAUTH_URL;
}

function handleOAuth(){
    var hash=window.location.hash.substring(1);
    if(!hash)return Promise.resolve(false);
    var params=new URLSearchParams(hash);
    var token=params.get('access_token');
    if(!token)return Promise.resolve(false);
    history.replaceState(null,'',window.location.pathname);
    return fetch('https://discord.com/api/users/@me',{headers:{'Authorization':'Bearer '+token}}).then(function(r){
        if(!r.ok)throw new Error('err');
        return r.json();
    }).then(function(u){
        currentUser={id:u.id,username:u.username,avatar:u.avatar,avatarUrl:u.avatar?'https://cdn.discordapp.com/avatars/'+u.id+'/'+u.avatar+'.png?size=64':'https://cdn.discordapp.com/embed/avatars/0.png'};
        localStorage.setItem('inj_user',JSON.stringify(currentUser));
        return true;
    }).catch(function(){return false});
}

function loadSession(){var s=localStorage.getItem('inj_user');if(s){currentUser=JSON.parse(s);return true}return false}
function logout(){currentUser=null;localStorage.removeItem('inj_user');stopPolling();navigateTo('landing');toast('Logged out','info')}
function isAuth(){return !!currentUser}
function isAdmin(){return currentUser&&currentUser.id===ADMIN_ID}

function navigateTo(view){
    document.querySelectorAll('.view').forEach(function(v){v.classList.remove('active')});
    currentView=view;
    if(view==='landing'){document.getElementById('viewLanding').classList.add('active');document.body.classList.remove('app-mode')}
    else if(view==='redeem'){
        if(!isAuth()){loginWithDiscord('redeem');return}
        document.getElementById('viewRedeem').classList.add('active');document.body.classList.add('app-mode');
        document.getElementById('redeemInput').value='';
        document.getElementById('redeemError').style.display='none';
        document.getElementById('redeemSuccess').style.display='none';
    }
    else if(view==='dashboard'){
        if(!isAuth()){loginWithDiscord('dashboard');return}
        checkAccess();return;
    }
    else if(view==='admin'){
        if(!isAdmin()){navigateTo('landing');return}
        document.getElementById('viewAdmin').classList.add('active');document.body.classList.add('app-mode');
        switchAdminTab('overview');
    }
    else if(view==='access-denied'){document.getElementById('viewAccessDenied').classList.add('active');document.body.classList.add('app-mode')}
    updateNav();window.scrollTo(0,0);
}

function checkAccess(){
    if(isAdmin()){showDashboard();return}
    fbGet('tickets').then(function(tickets){
        var ok=false;
        if(tickets){for(var k in tickets){var t=tickets[k];if(t.userId===currentUser.id&&t.redeemed&&t.status==='active'){if(t.expiry&&new Date(t.expiry)<new Date())continue;ok=true;break}}}
        if(ok){showDashboard()}else{currentView='access-denied';document.getElementById('viewAccessDenied').classList.add('active');document.body.classList.add('app-mode');updateNav()}
    });
}

function showDashboard(){document.getElementById('viewDashboard').classList.add('active');document.body.classList.add('app-mode');currentView='dashboard';updateNav();loadDashboard()}

function updateNav(){
    var els={login:document.getElementById('btnNavLogin'),redeem:document.getElementById('btnNavRedeem'),dash:document.getElementById('btnNavDashboard'),admin:document.getElementById('btnNavAdmin'),logout:document.getElementById('btnNavLogout'),userInfo:document.getElementById('navUserInfo')};
    for(var k in els)els[k].classList.add('nav-hidden');
    document.querySelectorAll('#navCenter [data-nav="landing"]').forEach(function(li){li.style.display=currentView==='landing'?'':'none'});
    if(isAuth()){
        els.userInfo.classList.remove('nav-hidden');document.getElementById('navAvatar').src=currentUser.avatarUrl;document.getElementById('navUsername').textContent=currentUser.username;
        els.logout.classList.remove('nav-hidden');els.redeem.classList.remove('nav-hidden');els.dash.classList.remove('nav-hidden');
        if(isAdmin())els.admin.classList.remove('nav-hidden');
    }else{els.login.classList.remove('nav-hidden')}
}

function scrollToSection(id){
    if(currentView!=='landing'){navigateTo('landing');setTimeout(function(){var el=document.getElementById(id);if(el)el.scrollIntoView({behavior:'smooth',block:'start'})},150)}
    else{var el=document.getElementById(id);if(el)el.scrollIntoView({behavior:'smooth',block:'start'})}
}

function handleGetStarted(){if(isAuth())navigateTo('dashboard');else loginWithDiscord('dashboard')}

function genCode(){
    var c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var out='';
    for(var i=0;i<15;i++){if(i===5||i===10)out+='-';out+=c[Math.floor(Math.random()*c.length)]}
    return out;
}

function regenerateTicketCode(){
    fbGet('tickets').then(function(tickets){
        tickets=tickets||{};
        var used={};for(var k in tickets)used[tickets[k].code]=1;
        var code,tries=0;
        do{code=genCode();tries++}while(used[code]&&tries<200);
        document.getElementById('ticketCodePreview').textContent=code;
    });
}

function redeemTicket(){
    var input=document.getElementById('redeemInput');
    var errEl=document.getElementById('redeemError');
    var okEl=document.getElementById('redeemSuccess');
    var code=input.value.trim();
    errEl.style.display='none';okEl.style.display='none';
    if(!code){errEl.textContent='Please enter a ticket code.';errEl.style.display='block';return}
    fbGet('tickets').then(function(tickets){
        tickets=tickets||{};
        var fk=null,ft=null;
        for(var k in tickets){if(tickets[k].code===code){fk=k;ft=tickets[k];break}}
        if(!ft){errEl.textContent='Invalid ticket code.';errEl.style.display='block';return}
        if(ft.userId!==currentUser.id){errEl.textContent='This code is not assigned to your account.';errEl.style.display='block';return}
        if(ft.status!=='active'){errEl.textContent='This ticket is inactive. Contact @bufferclick.';errEl.style.display='block';return}
        if(ft.expiry&&new Date(ft.expiry)<new Date()){errEl.textContent='This ticket has expired.';errEl.style.display='block';return}
        if(ft.redeemed){okEl.textContent='Already redeemed. Redirecting...';okEl.style.display='block';setTimeout(function(){navigateTo('dashboard')},800);return}
        fbPatch('tickets/'+fk,{redeemed:true,redeemedAt:Date.now()}).then(function(){
            return fbGet('dashboards/'+currentUser.id);
        }).then(function(existing){
            if(!existing)return fbPut('dashboards/'+currentUser.id,{files:{},running:false,ownerId:currentUser.id,ownerName:currentUser.username,createdAt:Date.now()});
        }).then(function(){
            okEl.textContent='Ticket redeemed! Redirecting to dashboard...';okEl.style.display='block';
            toast('Ticket redeemed successfully','success');
            setTimeout(function(){navigateTo('dashboard')},1200);
        });
    });
}

function loadDashboard(){
    var uid=currentUser.id;
    fbGet('dashboards/'+uid).then(function(data){
        if(!data){data={files:{},running:false,ownerId:uid,ownerName:currentUser.username,createdAt:Date.now()};fbPut('dashboards/'+uid,data)}
        dashData=data;dashData.files=decodeFiles(data.files);openFile=null;editorDirty={};
        renderFiles();syncStatus();
        if(dashData.running)startPolling();
    });
}

function renderFiles(){
    var list=document.getElementById('dashFileList');
    var names=Object.keys(dashData.files).sort();
    list.innerHTML='';
    if(names.length===0){document.getElementById('dashEmpty').style.display='flex';document.getElementById('dashEditor').classList.remove('active');return}
    document.getElementById('dashEmpty').style.display='none';
    names.forEach(function(n){
        var item=document.createElement('div');
        item.className='dash-file-item'+(openFile===n?' active':'');
        item.innerHTML='<span class="dash-file-name">'+esc(n)+'</span><button class="dash-file-delete" onclick="event.stopPropagation();promptDelFile(\''+escA(n)+'\')" title="Delete">&times;</button>';
        item.onclick=function(){fileOpen(n)};
        list.appendChild(item);
    });
}

function fileOpen(name){
    if(openFile&&editorDirty[openFile]!==undefined){dashData.files[openFile]=Object.assign({},dashData.files[openFile]||{},{content:editorDirty[openFile]})}
    openFile=name;
    var f=dashData.files[name]||{};
    document.getElementById('dashEditor').classList.add('active');
    document.getElementById('dashEmpty').style.display='none';
    var ta=document.getElementById('editorTextarea');
    ta.value=f.content||'';editorDirty[name]=ta.value;
    updateLines('editorLines','editorTextarea');renderTabs();renderFiles();
}

function renderTabs(){
    var c=document.getElementById('dashEditorTabs');c.innerHTML='';
    if(!openFile)return;
    var tab=document.createElement('button');tab.className='dash-editor-tab active';
    tab.innerHTML=esc(openFile)+' <span class="tab-close" onclick="event.stopPropagation();fileClose()">&times;</span>';
    c.appendChild(tab);
}

function fileClose(){openFile=null;document.getElementById('dashEditor').classList.remove('active');if(Object.keys(dashData.files).length===0)document.getElementById('dashEmpty').style.display='flex';renderFiles()}

function saveCurrentFile(){
    if(!openFile)return;
    var content=document.getElementById('editorTextarea').value;
    var fileObj={content:content,_name:openFile,updatedAt:Date.now()};
    dashData.files[openFile]=fileObj;editorDirty[openFile]=content;
    fbPut('dashboards/'+currentUser.id+'/files/'+fKey(openFile),fileObj).then(function(){toast(openFile+' saved','success')});
}

function openNewFileModal(){
    document.getElementById('newFileName').value='';
    document.getElementById('newFileError').style.display='none';
    openModal('modalNewFile');
    setTimeout(function(){document.getElementById('newFileName').focus()},100);
}

function createNewFile(){
    var nameEl=document.getElementById('newFileName');
    var errEl=document.getElementById('newFileError');
    var name=nameEl.value.trim();
    errEl.style.display='none';
    if(!name){errEl.textContent='Enter a filename.';errEl.style.display='block';return}
    if(dashData.files[name]){errEl.textContent='File already exists.';errEl.style.display='block';return}
    var fileObj={content:'',_name:name,createdAt:Date.now(),updatedAt:Date.now()};
    dashData.files[name]=fileObj;
    fbPut('dashboards/'+currentUser.id+'/files/'+fKey(name),fileObj).then(function(){
        closeModal('modalNewFile');fileOpen(name);toast(name+' created','success');
    });
}

function promptDelFile(name){deleteFileTarget=name;document.getElementById('deleteFileName').textContent=name;openModal('modalDeleteFile')}

function confirmDeleteFile(){
    if(!deleteFileTarget)return;
    var n=deleteFileTarget;
    delete dashData.files[n];delete editorDirty[n];
    fbDel('dashboards/'+currentUser.id+'/files/'+fKey(n)).then(function(){
        if(openFile===n)fileClose();renderFiles();closeModal('modalDeleteFile');toast(n+' deleted','info');deleteFileTarget=null;
    });
}

function runBot(){
    var names=Object.keys(dashData.files);
    if(names.length===0){toast('Add at least one file first.','error');return}
    if(openFile){
        var content=document.getElementById('editorTextarea').value;
        var fo={content:content,_name:openFile,updatedAt:Date.now()};
        dashData.files[openFile]=fo;
        fbPut('dashboards/'+currentUser.id+'/files/'+fKey(openFile),fo);
    }
    dashData.running=true;
    fbPatch('dashboards/'+currentUser.id,{running:true,lastStarted:Date.now()});
    clearConsole();cLog('Syncing files to server...','info');cLog('All files uploaded successfully.','success');cLog('Starting bot process...','info');cLog('Waiting for output...','info');
    syncStatus();startPolling();toast('Bot starting...','success');
}

function stopBot(){
    dashData.running=false;
    fbPatch('dashboards/'+currentUser.id,{running:false});
    cLog('Stop signal sent.','warn');cLog('Bot process terminated.','info');
    syncStatus();stopPolling();toast('Bot stopped','info');
}

function syncStatus(){
    var dot=document.getElementById('dashStatusDot');var text=document.getElementById('dashStatusText');
    var bRun=document.getElementById('btnRun');var bStp=document.getElementById('btnStop');
    if(dashData.running){dot.className='status-dot running';text.textContent='Running';bRun.style.display='none';bStp.style.display=''}
    else{dot.className='status-dot';text.textContent='Stopped';bRun.style.display='';bStp.style.display='none'}
}

function cLog(msg,type){
    var body=document.getElementById('consoleBody');var line=document.createElement('div');line.className='console-line';
    line.innerHTML='<span class="console-time">'+ts()+'</span><span class="console-msg '+(type||'')+'">'+esc(msg)+'</span>';
    body.appendChild(line);body.scrollTop=body.scrollHeight;
}

function clearConsole(){document.getElementById('consoleBody').innerHTML=''}
function toggleConsole(){document.getElementById('dashConsole').classList.toggle('collapsed')}

function startPolling(){
    stopPolling();
    pollInterval=setInterval(function(){
        fbGet('dashboards/'+currentUser.id+'/consoleOutput').then(function(out){
            if(out){
                var body=document.getElementById('consoleBody');body.innerHTML='';
                var entries=Array.isArray(out)?out:Object.values(out);
                entries.forEach(function(e){
                    var line=document.createElement('div');line.className='console-line';
                    line.innerHTML='<span class="console-time">'+esc(e.time||'--:--:--')+'</span><span class="console-msg '+(e.type||'')+'">'+esc(e.msg||'')+'</span>';
                    body.appendChild(line);
                });
                body.scrollTop=body.scrollHeight;
            }
        });
        fbGet('dashboards/'+currentUser.id+'/running').then(function(running){
            if(running!==dashData.running){dashData.running=!!running;syncStatus();if(!running)stopPolling()}
        });
    },3000);
}

function stopPolling(){if(pollInterval){clearInterval(pollInterval);pollInterval=null}}

function updateLines(linesId,textareaId){
    var ta=document.getElementById(textareaId);var ln=document.getElementById(linesId);
    var count=(ta.value.match(/\n/g)||[]).length+1;
    var html='';for(var i=1;i<=count;i++)html+=i+'<br>';
    ln.innerHTML=html;
}

function switchAdminTab(tab){
    document.querySelectorAll('.admin-nav-item').forEach(function(i){i.classList.toggle('active',i.dataset.adminTab===tab)});
    document.querySelectorAll('.admin-tab-content').forEach(function(el){el.style.display='none'});
    var map={overview:'adminTabOverview',tickets:'adminTabTickets',create:'adminTabCreate',dashboards:'adminTabDashboards'};
    var el=document.getElementById(map[tab]);if(el)el.style.display='';
    if(tab==='overview')loadOverview();
    if(tab==='tickets')loadTickets();
    if(tab==='create')regenerateTicketCode();
    if(tab==='dashboards')loadDashboards();
}

function loadOverview(){
    Promise.all([fbGet('tickets'),fbGet('dashboards')]).then(function(res){
        var tickets=res[0]||{};var dashes=res[1]||{};
        var arr=Object.values(tickets);
        document.getElementById('statTotalTickets').textContent=arr.length;
        document.getElementById('statActiveTickets').textContent=arr.filter(function(t){return t.status==='active'}).length;
        document.getElementById('statInactiveTickets').textContent=arr.filter(function(t){return t.status!=='active'}).length;
        document.getElementById('statRunning').textContent=Object.values(dashes).filter(function(d){return d.running}).length;
        var sorted=Object.entries(tickets).sort(function(a,b){return(b[1].createdAt||0)-(a[1].createdAt||0)}).slice(0,6);
        renderTicketCards(sorted,document.getElementById('adminRecentTickets'));
    });
}

function loadTickets(){
    fbGet('tickets').then(function(tickets){
        tickets=tickets||{};
        allTicketCache=Object.entries(tickets).sort(function(a,b){return(b[1].createdAt||0)-(a[1].createdAt||0)});
        renderTicketCards(allTicketCache,document.getElementById('adminAllTickets'));
    });
}

function filterTickets(){
    var q=document.getElementById('ticketSearch').value.toLowerCase().trim();
    var filtered=allTicketCache.filter(function(e){var t=e[1];return t.code.toLowerCase().indexOf(q)!==-1||(t.userId||'').indexOf(q)!==-1||(t.label||'').toLowerCase().indexOf(q)!==-1});
    renderTicketCards(filtered,document.getElementById('adminAllTickets'));
}

function renderTicketCards(entries,container){
    if(entries.length===0){container.innerHTML='<div class="empty-state"><h4>No tickets found</h4><p>Create one from the Create Ticket tab.</p></div>';return}
    container.innerHTML=entries.map(function(e){
        var key=e[0],t=e[1];
        var sc=t.status||'inactive';
        if(t.expiry&&new Date(t.expiry)<new Date())sc='expired';
        return '<div class="ticket-card"><div class="ticket-code">'+esc(t.code)+'</div><div class="ticket-meta"><div class="ticket-meta-row"><span class="ticket-meta-label">User ID</span><span class="ticket-meta-value">'+esc(t.userId||'N/A')+'</span></div><div class="ticket-meta-row"><span class="ticket-meta-label">Status</span><span class="ticket-status '+sc+'">'+sc+'</span></div><div class="ticket-meta-row"><span class="ticket-meta-label">Redeemed</span><span class="ticket-meta-value">'+(t.redeemed?'Yes':'No')+'</span></div>'+(t.label?'<div class="ticket-meta-row"><span class="ticket-meta-label">Label</span><span class="ticket-meta-value">'+esc(t.label)+'</span></div>':'')+(t.expiry?'<div class="ticket-meta-row"><span class="ticket-meta-label">Expires</span><span class="ticket-meta-value">'+t.expiry+'</span></div>':'')+'<div class="ticket-meta-row"><span class="ticket-meta-label">Created</span><span class="ticket-meta-value">'+(t.createdAt?new Date(t.createdAt).toLocaleDateString():'N/A')+'</span></div></div><div class="ticket-actions"><button class="btn-xs '+(t.status==='active'?'btn-danger':'btn-success')+'" onclick="toggleTicket(\''+key+'\',\''+(t.status==='active'?'inactive':'active')+'\')">'+(t.status==='active'?'Deactivate':'Activate')+'</button><button class="btn-xs btn-danger" onclick="promptDelTicket(\''+key+'\')">Delete</button></div></div>';
    }).join('');
}

function toggleTicket(key,status){
    fbPatch('tickets/'+key,{status:status}).then(function(){
        toast('Ticket '+status,'success');
        var tab=document.querySelector('.admin-nav-item.active');
        if(tab)switchAdminTab(tab.dataset.adminTab);
    });
}

function promptDelTicket(key){deleteTicketTarget=key;openModal('modalDeleteTicket')}

function confirmDeleteTicket(){
    if(!deleteTicketTarget)return;
    fbDel('tickets/'+deleteTicketTarget).then(function(){
        closeModal('modalDeleteTicket');toast('Ticket deleted','info');deleteTicketTarget=null;
        var tab=document.querySelector('.admin-nav-item.active');
        if(tab)switchAdminTab(tab.dataset.adminTab);
    });
}

function createTicket(){
    var userId=document.getElementById('ticketUserId').value.trim();
    var code=document.getElementById('ticketCodePreview').textContent.trim();
    var expiry=document.getElementById('ticketExpiry').value;
    var status=document.querySelector('input[name="ticketStatus"]:checked').value;
    var label=document.getElementById('ticketLabel').value.trim();
    var errEl=document.getElementById('createTicketError');
    var okEl=document.getElementById('createTicketSuccess');
    errEl.style.display='none';okEl.style.display='none';
    if(!userId){errEl.textContent='Enter a Discord User ID.';errEl.style.display='block';return}
    if(!code||code==='-----'){errEl.textContent='Generate a code first.';errEl.style.display='block';return}
    var tKey=code.replace(/-/g,'');
    fbPut('tickets/'+tKey,{code:code,userId:userId,status:status,expiry:expiry||null,label:label||null,redeemed:false,createdAt:Date.now()}).then(function(){
        okEl.textContent='Ticket created: '+code;okEl.style.display='block';
        toast('Ticket created','success');
        document.getElementById('ticketUserId').value='';document.getElementById('ticketExpiry').value='';document.getElementById('ticketLabel').value='';
        regenerateTicketCode();
    });
}

function loadDashboards(){
    fbGet('dashboards').then(function(d){d=d||{};allDashCache=d;renderDashCards(d)});
}

function filterDashboards(){
    var q=document.getElementById('dashboardSearch').value.toLowerCase().trim();
    var filtered={};
    for(var id in allDashCache){var d=allDashCache[id];if(id.indexOf(q)!==-1||(d.ownerName||'').toLowerCase().indexOf(q)!==-1)filtered[id]=d}
    renderDashCards(filtered);
}

function renderDashCards(dashboards){
    var container=document.getElementById('adminAllDashboards');
    var entries=Object.entries(dashboards);
    if(entries.length===0){container.innerHTML='<div class="empty-state"><h4>No dashboards found</h4></div>';return}
    container.innerHTML=entries.map(function(e){
        var uid=e[0],d=e[1];
        var fc=d.files?Object.keys(d.files).length:0;
        var run=d.running===true;
        return '<div class="admin-dash-card"><h4>'+esc(d.ownerName||'Unknown')+'</h4><div class="admin-dash-meta"><span>ID: '+esc(uid)+'</span><span>Files: '+fc+'</span><span>Status: '+(run?'<span style="color:var(--success)">Running</span>':'Stopped')+'</span>'+(d.createdAt?'<span>Created: '+new Date(d.createdAt).toLocaleDateString()+'</span>':'')+'</div><div class="admin-dash-actions"><button class="btn-xs btn-secondary" onclick="openViewer(\''+escA(uid)+'\')">View Files</button>'+(run?'<button class="btn-xs btn-danger" onclick="adminStop(\''+escA(uid)+'\')">Shutdown</button>':'')+'</div></div>';
    }).join('');
}

function adminStop(uid){fbPatch('dashboards/'+uid,{running:false}).then(function(){toast('Dashboard shut down','info');loadDashboards()})}

function openViewer(uid){
    viewerUserId=uid;
    fbGet('dashboards/'+uid).then(function(data){
        data=data||{files:{}};viewerData=data;viewerData.files=decodeFiles(data.files);viewerOpenFile=null;
        document.getElementById('adminViewerTitle').textContent='Viewing: '+(data.ownerName||uid);
        var dot=document.getElementById('adminViewerDot');var st=document.getElementById('adminViewerStatus');
        if(data.running){dot.className='status-dot running';st.textContent='Running'}else{dot.className='status-dot';st.textContent='Stopped'}
        renderViewerFiles();
        document.getElementById('adminViewerOverlay').classList.add('active');
    });
}

function closeAdminViewer(){document.getElementById('adminViewerOverlay').classList.remove('active');viewerUserId=null}

function renderViewerFiles(){
    var list=document.getElementById('adminViewerFileList');
    var names=Object.keys(viewerData.files).sort();
    list.innerHTML='';
    var emEl=document.getElementById('adminViewerEmpty');var edEl=document.getElementById('adminViewerEditor');
    if(names.length===0){emEl.style.display='flex';edEl.classList.remove('active');return}
    emEl.style.display='none';
    names.forEach(function(n){
        var item=document.createElement('div');
        item.className='dash-file-item'+(viewerOpenFile===n?' active':'');
        item.innerHTML='<span class="dash-file-name">'+esc(n)+'</span>';
        item.onclick=function(){viewerFileOpen(n)};
        list.appendChild(item);
    });
}

function viewerFileOpen(name){
    if(viewerOpenFile){viewerData.files[viewerOpenFile]=Object.assign({},viewerData.files[viewerOpenFile]||{},{content:document.getElementById('adminViewerTextarea').value})}
    viewerOpenFile=name;var f=viewerData.files[name]||{};
    document.getElementById('adminViewerEditor').classList.add('active');
    document.getElementById('adminViewerEmpty').style.display='none';
    document.getElementById('adminViewerTextarea').value=f.content||'';
    updateLines('adminViewerLines','adminViewerTextarea');
    document.getElementById('adminViewerTabs').innerHTML='<button class="dash-editor-tab active">'+esc(name)+'</button>';
    renderViewerFiles();
}

function adminViewerSave(){
    if(!viewerOpenFile||!viewerUserId)return;
    var content=document.getElementById('adminViewerTextarea').value;
    var obj={content:content,_name:viewerOpenFile,updatedAt:Date.now()};
    viewerData.files[viewerOpenFile]=obj;
    fbPut('dashboards/'+viewerUserId+'/files/'+fKey(viewerOpenFile),obj).then(function(){toast(viewerOpenFile+' saved','success')});
}

function adminViewerAddFile(){
    document.getElementById('adminNewFileName').value='';document.getElementById('adminNewFileError').style.display='none';
    openModal('modalAdminNewFile');setTimeout(function(){document.getElementById('adminNewFileName').focus()},100);
}

function adminViewerCreateFile(){
    var name=document.getElementById('adminNewFileName').value.trim();
    var errEl=document.getElementById('adminNewFileError');errEl.style.display='none';
    if(!name){errEl.textContent='Enter a filename.';errEl.style.display='block';return}
    if(viewerData.files[name]){errEl.textContent='File already exists.';errEl.style.display='block';return}
    var obj={content:'',_name:name,createdAt:Date.now(),updatedAt:Date.now()};
    viewerData.files[name]=obj;
    fbPut('dashboards/'+viewerUserId+'/files/'+fKey(name),obj).then(function(){
        closeModal('modalAdminNewFile');viewerFileOpen(name);toast(name+' added','success');
    });
}

function esc(s){if(!s)return '';var d=document.createElement('div');d.textContent=String(s);return d.innerHTML}
function escA(s){return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}
function ts(){return new Date().toTimeString().slice(0,8)}
function openModal(id){document.getElementById(id).classList.add('active')}
function closeModal(id){document.getElementById(id).classList.remove('active')}

function toast(msg,type){
    var c=document.getElementById('toastContainer');var t=document.createElement('div');
    t.className='toast '+(type||'info');t.textContent=msg;c.appendChild(t);
    setTimeout(function(){t.style.opacity='0';t.style.transition='opacity .3s';setTimeout(function(){t.remove()},300)},3500);
}

document.getElementById('editorTextarea').addEventListener('input',function(){updateLines('editorLines','editorTextarea');if(openFile)editorDirty[openFile]=this.value});
document.getElementById('editorTextarea').addEventListener('scroll',function(){document.getElementById('editorLines').scrollTop=this.scrollTop});
document.getElementById('editorTextarea').addEventListener('keydown',function(e){
    if(e.key==='Tab'){e.preventDefault();var s=this.selectionStart;this.value=this.value.substring(0,s)+'    '+this.value.substring(this.selectionEnd);this.selectionStart=this.selectionEnd=s+4;updateLines('editorLines','editorTextarea');if(openFile)editorDirty[openFile]=this.value}
    if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();saveCurrentFile()}
});
document.getElementById('adminViewerTextarea').addEventListener('input',function(){updateLines('adminViewerLines','adminViewerTextarea')});
document.getElementById('adminViewerTextarea').addEventListener('scroll',function(){document.getElementById('adminViewerLines').scrollTop=this.scrollTop});
document.getElementById('adminViewerTextarea').addEventListener('keydown',function(e){
    if(e.key==='Tab'){e.preventDefault();var s=this.selectionStart;this.value=this.value.substring(0,s)+'    '+this.value.substring(this.selectionEnd);this.selectionStart=this.selectionEnd=s+4;updateLines('adminViewerLines','adminViewerTextarea')}
    if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();adminViewerSave()}
});
document.getElementById('redeemInput').addEventListener('input',function(){
    var clean=this.value.replace(/[^a-zA-Z0-9]/g,'');
    if(clean.length>15)clean=clean.substring(0,15);
    var out='';for(var i=0;i<clean.length;i++){if(i===5||i===10)out+='-';out+=clean[i]}
    this.value=out;
});

document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){document.querySelectorAll('.modal-overlay.active').forEach(function(m){m.classList.remove('active')});if(document.getElementById('adminViewerOverlay').classList.contains('active'))closeAdminViewer()}
    if((e.ctrlKey||e.metaKey)&&e.key==='s')e.preventDefault();
});
document.querySelectorAll('.modal-overlay').forEach(function(o){o.addEventListener('click',function(e){if(e.target===o)o.classList.remove('active')})});

function initEffects(){
    var glow=document.getElementById('cursorGlow');
    document.addEventListener('mousemove',function(e){glow.style.left=e.clientX+'px';glow.style.top=e.clientY+'px'});
    function checkReveal(){document.querySelectorAll('.reveal').forEach(function(el){if(el.getBoundingClientRect().top<window.innerHeight-100)el.classList.add('active')})}
    window.addEventListener('scroll',checkReveal);checkReveal();
    var bar=document.getElementById('loadingBar');bar.style.width='100%';setTimeout(function(){bar.style.opacity='0'},600);
    window.addEventListener('scroll',function(){var max=document.documentElement.scrollHeight-document.documentElement.clientHeight;if(max>0){bar.style.width=(window.scrollY/max*100)+'%';bar.style.opacity='1'}});
}

function init(){
    initEffects();
    handleOAuth().then(function(oauthOk){
        if(!oauthOk)loadSession();
        updateNav();
        if(oauthOk){var ret=localStorage.getItem('inj_return')||'dashboard';localStorage.removeItem('inj_return');navigateTo(ret)}
    });
}

init();
