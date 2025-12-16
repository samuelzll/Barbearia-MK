/* scripts.js - COMPLETO COM DURAÇÃO VARIÁVEL E BLOQUEIO DE DIAS */

// ===============================================
// DADOS FIXOS E CONFIGURAÇÕES DE HORÁRIO
// ===============================================

const SERVICOS = {
    "Corte": { preco: 35, duracao: 30 },
    "Corte + Sobrancelha": { preco: 40, duracao: 35 },
    "Barba": { preco: 30, duracao: 30 },
    "Combo Corte + Barba": { preco: 55, duracao: 60 }, // Duração: 60 min (2 slots)
    "Corte + Pigmentação": { preco: 45, duracao: 60 }, // Duração: 60 min (2 slots)
    "Corte + Luzes": { preco: 90, duracao: 60 },       // Duração: 60 min (2 slots)
    "Nevou": { preco: 110, duracao: 90 },              // Duração: 90 min (3 slots)
    "Corte + Reflexo": { preco: 100, duracao: 60 }   // Duração: 90 min (3 slots)
};

const ADMIN_PASSWORD = "mkadmin135";
const ADMIN_SESSION_KEY = "estilomk_admin";
const INTERVALO_MIN = 30; // Duração base de cada slot
const HORARIOS_DIA = {
    0: null, // Domingo
    1: null, // Segunda
    2: { inicio: "09:00", fim: "19:30" }, // Terça
    3: { inicio: "09:00", fim: "19:30" }, // Quarta
    4: { inicio: "09:00", fim: "19:30" }, // Quinta
    5: { inicio: "08:00", fim: "22:00" }, // Sexta
    6: { inicio: "08:00", fim: "20:00" } // Sábado
};

// ===============================================
// VARIÁVEIS DE BLOQUEIO E FIREBASE (GLOBAL)
// ===============================================

const BLOCKED_DAYS_COLLECTION = "dias_bloqueados";
let blockedDaysCache = []; 

// Elementos DOM (assumindo que estão em agendar.html)
const dataInput = document.getElementById('dataAgendamento');
const horaSelect = document.getElementById('horaAgendamento');
const nomeInput = document.getElementById('nomeAgendamento');
const telefoneInput = document.getElementById('telefoneAgendamento');
const servicoSelect = document.getElementById('servicoAgendamento');
const barbeiroInput = document.getElementById('barbeiroSelecionado');
const resultadoEl = document.getElementById('resultadoAgendamento');
const btnConfirm = document.getElementById('btnConfirmarAgendamento');
const btnAbrirPainel = document.getElementById('btnAbrirPainel');
const painel = document.getElementById('painelAgendamentos');
const listaEl = document.getElementById('listaAgendamentos');

// VARIÁVEIS GLOBAIS FIREBASE (Serão populadas por waitForFirebase)
let db = window.db || null;
let collection = window._firebase ? window._firebase.collection : null;
let setDoc = window._firebase ? window._firebase.setDoc : null;
let getDocs = window._firebase ? window._firebase.getDocs : null;
let doc = window._firebase ? window._firebase.doc : null;
let deleteDoc = window._firebase ? window._firebase.deleteDoc : null;
let query = window._firebase ? window._firebase.query : null;
let where = window._firebase ? window._firebase.where : null;


// ===============================================
// FUNÇÕES AUXILIARES GERAIS
// ===============================================

/* util: espera o Firebase ficar disponível */
async function waitForFirebase(timeout = 3000) {
    const start = Date.now();
    while ((!window.db || !window._firebase) && (Date.now() - start) < timeout) {
        await new Promise(r => setTimeout(r, 100));
    }
    // ATUALIZA AS VARIÁVEIS GLOBAIS
    db = window.db || null;
    if (window._firebase) {
        ({ collection, setDoc, getDocs, doc, deleteDoc, query, where } = window._firebase);
    }
    return !!db;
}

/* IDs */
function gerarId() { return 'ag-' + Date.now() + '-' + Math.floor(Math.random() * 10000); }

/* helpers de horário */
function timeStringToMinutes(t) {
    if (!t) return 0;
    const [hh, mm] = t.split(":").map(Number);
    return hh * 60 + mm;
}
function minutesToTimeString(m) {
    const hh = Math.floor(m / 60).toString().padStart(2, '0');
    const mm = (m % 60).toString().padStart(2, '0');
    return `${hh}:${mm}`;
}

// ===============================================
// FUNÇÕES DE BLOQUEIO DE DIAS (Item 2)
// ===============================================

/** Carrega os dias bloqueados para o cache. */
async function loadBlockedDays() {
    await waitForFirebase();
    if (!db) return;
    try {
        const querySnapshot = await getDocs(collection(db, BLOCKED_DAYS_COLLECTION));
        blockedDaysCache = querySnapshot.docs.map(doc => doc.data().data);
        // console.log("Dias bloqueados carregados:", blockedDaysCache);
    } catch (e) {
        console.error("Erro ao carregar dias bloqueados:", e);
    }
}

/** Verifica se um dia está bloqueado. */
function isDayBlocked(dateString) {
    return blockedDaysCache.includes(dateString);
}

/** Bloqueia um dia inteiro. Usado pelo Admin HTML. */
async function blockDay(dateString) {
    if (!dateString || isDayBlocked(dateString)) return false;
    await waitForFirebase();
    if (!db) return false;
    
    try {
        await setDoc(doc(db, BLOCKED_DAYS_COLLECTION, dateString), {
            data: dateString,
            bloqueado_em: new Date().toISOString()
        });
        blockedDaysCache.push(dateString);
        alert(`Dia ${dateString} bloqueado com sucesso!`);
        await onDataChange(); // Atualiza a visualização do formulário de agendamento
        return true;
    } catch (e) {
        console.error("Erro ao bloquear o dia:", e);
        return false;
    }
}
window.blockDay = blockDay; // Exposição global

/** Desbloqueia um dia inteiro. Usado pelo Admin HTML. */
async function unblockDay(dateString) {
    if (!dateString || !isDayBlocked(dateString)) return false;
    await waitForFirebase();
    if (!db) return false;

    try {
        await deleteDoc(doc(db, BLOCKED_DAYS_COLLECTION, dateString));
        blockedDaysCache = blockedDaysCache.filter(day => day !== dateString);
        alert(`Dia ${dateString} desbloqueado com sucesso!`);
        await onDataChange(); // Atualiza a visualização do formulário de agendamento
        return true;
    } catch (e) {
        console.error("Erro ao desbloquear o dia:", e);
        return false;
    }
}
window.unblockDay = unblockDay; // Exposição global


// ===============================================
// FIREBASE HELPERS (PERSISTÊNCIA DE SLOTS MÚLTIPLOS)
// ===============================================

async function carregarBlockedSlots() {
    if (!db) {
        console.warn('carregarBlockedSlots: Firestore não pronto, retornando []');
        return [];
    }
    try {
        const snap = await getDocs(collection(db, "blockedSlots"));
        const lista = [];
        snap.forEach(d => {
            const data = d.data();
            data.barbeiro = (data.barbeiro || '').trim();
            lista.push(Object.assign({}, data, { __key: d.id }));
        });
        return lista;
    } catch (err) {
        console.error('Erro carregarBlockedSlots', err);
        return [];
    }
}

/** Salva o agendamento principal e todos os slots de 30 minutos consumidos (Item 1) */
async function salvarAgendamentoFirestore(a) {
    if (!db) throw new Error('Firestore não inicializado');
    const barbeiro = (a.barbeiro || '').trim();
    const duracaoServico = (a.servico && SERVICOS[a.servico]) ? SERVICOS[a.servico].duracao : INTERVALO_MIN;
    const slotsNecessarios = Math.ceil(duracaoServico / INTERVALO_MIN);

    // 1. Salva o agendamento principal
    try {
        await setDoc(doc(db, "agendamentos", a.id), Object.assign({}, a, {
            slots_consumidos: slotsNecessarios
        }));
    } catch (err) {
        console.error('Erro salvarAgendamentoFirestore principal', err);
        throw err;
    }

    // 2. Bloqueia todos os slots de 30 minutos consumidos
    let currentTimeMin = timeStringToMinutes(a.hora);
    
    for (let i = 0; i < slotsNecessarios; i++) {
        const slotHora = minutesToTimeString(currentTimeMin);
        const slotId = `${a.data}_${barbeiro}_${slotHora}`;
        
        try {
            await setDoc(doc(db, "blockedSlots", slotId), {
                date: a.data,
                barbeiro: barbeiro,
                hora: slotHora,
                agendamentoId: a.id
            });
        } catch (err) {
            console.error(`Erro ao bloquear slot ${slotId}`, err);
        }

        currentTimeMin += INTERVALO_MIN;
    }
}

/** Exclui o agendamento principal e todos os slots associados (Item 1) */
async function excluirAgendamentoFirestore(id) {
    if (!db) {
        console.warn('Firestore não pronto para excluir');
        return;
    }
    try {
        await deleteDoc(doc(db, "agendamentos", id));
        
        if (query && where) {
            // Busca e exclui todos os slots bloqueados por este agendamento
            const q = query(collection(db, "blockedSlots"), where("agendamentoId", "==", id));
            const snap = await getDocs(q);
            
            const batch = [];
            snap.forEach(d => {
                batch.push(deleteDoc(doc(db, "blockedSlots", d.id)));
            });
            await Promise.all(batch);
        } else {
            console.warn("Funções de query ausentes. Slots bloqueados não foram excluídos.");
        }
    } catch (err) {
        console.warn("Erro ao excluir agendamento:", err);
    }
}


// ===============================================
// FUNÇÕES DE DISPONIBILIDADE (LÓGICA DO CALENDÁRIO)
// ===============================================

/* GERA HORÁRIOS DISPONÍVEIS - COM CHECAGEM DE SLOTS MÚLTIPLOS (Item 1) */
async function gerarHorariosDisponiveis(dateStr, barbeiro, servico) {
    await waitForFirebase();
    if (!dateStr) return [];
    barbeiro = (barbeiro || '').trim();

    // 1. CHECAGEM DE BLOQUEIO DO DIA (Item 2)
    if (isDayBlocked(dateStr)) {
        return [];
    }

    const diaDate = new Date(dateStr + 'T00:00:00');
    const dia = diaDate.getDay();
    const horarioDia = HORARIOS_DIA[dia];
    if (!horarioDia) return [];

    // 2. CONFIGURAÇÃO DE DURAÇÃO
    const duracaoServico = (servico && SERVICOS[servico]) ? SERVICOS[servico].duracao : INTERVALO_MIN;
    const slotsNecessarios = Math.ceil(duracaoServico / INTERVALO_MIN);

    // 3. GERAÇÃO DE TODOS OS SLOTS POSSÍVEIS (base de 30 min)
    const inicioMin = timeStringToMinutes(horarioDia.inicio);
    const fimMin = timeStringToMinutes(horarioDia.fim);
    const allSlots = [];
    const ultimoSlotInicioMin = fimMin - (slotsNecessarios * INTERVALO_MIN);

    for (let t = inicioMin; t <= ultimoSlotInicioMin; t += INTERVALO_MIN) {
        allSlots.push(minutesToTimeString(t));
    }
    
    // 4. BLOQUEIOS EXISTENTES
    const blocked = await carregarBlockedSlots();
    const bloqueadosParaDiaBarbeiro = new Set(
        blocked
            .filter(b => b.date === dateStr && (b.barbeiro||'').trim() === barbeiro)
            .map(b => b.hora)
    );
    
    // 5. FILTRAGEM PARA ENCONTRAR SLOTS CONTÍNUOS
    const disponiveisFinais = [];

    for (const slotInicio of allSlots) {
        let isAvailable = true;
        let currentTimeMin = timeStringToMinutes(slotInicio);
        
        for (let i = 0; i < slotsNecessarios; i++) {
            const slotToCheckTime = minutesToTimeString(currentTimeMin);
            
            if (bloqueadosParaDiaBarbeiro.has(slotToCheckTime)) {
                isAvailable = false;
                break;
            }
            currentTimeMin += INTERVALO_MIN;
        }

        if (isAvailable) {
            disponiveisFinais.push(slotInicio);
        }
    }
    
    return disponiveisFinais;
}

// ===============================================
// FUNÇÕES DE AGENDAMENTO (DOM & LISTENERS)
// ===============================================

/* POPULA SERVIÇOS */
function popularServicos() {
    if (!servicoSelect) return;
    servicoSelect.innerHTML = "";
    for (let nome in SERVICOS) {
        const opt = document.createElement("option");
        opt.value = nome;
        opt.innerText = `${nome} — R$${SERVICOS[nome].preco} — ${SERVICOS[nome].duracao}min`;
        servicoSelect.appendChild(opt);
    }
    servicoSelect.selectedIndex = 0;
}

/* SELEÇÃO DE BARBEIRO */
function setupBarbeiroSelection() {
    document.querySelectorAll(".barbeiro-card").forEach(card => {
        card.addEventListener("click", function () {
            document.querySelectorAll(".barbeiro-card").forEach(c => c.classList.remove("selecionado"));
            this.classList.add("selecionado");
            barbeiroInput.value = (this.getAttribute("data-barbeiro") || "").trim();
            onDataChange();
        });
    });
}

/* atualiza select de horas com base nos inputs (NOVO COM SERVIÇO E BLOQUEIO) */
async function onDataChange() {
    if (!dataInput || !horaSelect) return;
    await loadBlockedDays(); // Atualiza cache
    
    const dataVal = dataInput.value;
    const barbeiro = (barbeiroInput.value || '').trim();
    const servico = servicoSelect.value;
    horaSelect.innerHTML = "";
    
    const addOption = (text, disabled = true) => {
        const opt = document.createElement('option');
        opt.innerText = text;
        opt.disabled = disabled;
        opt.selected = disabled;
        horaSelect.appendChild(opt);
    }

    if (!dataVal) { addOption('Escolha uma data'); return; }
    if (!barbeiro) { addOption('Selecione um barbeiro'); return; }
    if (!servico) { addOption('Selecione um serviço'); return; }

    const dia = new Date(dataVal + 'T00:00:00');
    const today = new Date();
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    if (dia < todayMidnight) { addOption('Data inválida (passado)'); return; }

    try {
        const slots = await gerarHorariosDisponiveis(dataVal, barbeiro, servico); 
        
        if (isDayBlocked(dataVal)) {
            addOption('Dia bloqueado pelo administrador');
            return;
        }
        
        if (!slots.length) { 
            addOption('Sem horários disponíveis');
            return; 
        }
        
        slots.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.innerText = s;
            horaSelect.appendChild(opt);
        });
        horaSelect.selectedIndex = 0;
    } catch (err) {
        console.error('Erro onDataChange:', err);
        addOption('Erro ao carregar horários');
    }
}

/* confirmar agendamento */
async function onConfirmar(e) {
    if (e && e.preventDefault) e.preventDefault();
    
    if (!await waitForFirebase()) {
        if (resultadoEl) {
            resultadoEl.innerText = 'Erro: Falha na conexão com o sistema. Recarregue a página.';
            resultadoEl.style.color = 'red';
        }
        return;
    }

    const nome = (nomeInput.value || '').trim();
    const telefone = (telefoneInput.value || '').trim();
    const servico = servicoSelect.value;
    const barbeiro = (barbeiroInput.value || '').trim();
    const data = dataInput.value;
    const hora = horaSelect.value;
    
    if (!nome || !telefone || !servico || !barbeiro || !data || !hora) {
        if (resultadoEl) {
            resultadoEl.innerText = 'Preencha todos os campos.';
            resultadoEl.style.color = 'red';
        }
        return;
    }
    
    const agendamento = { id: gerarId(), nome, telefone, servico, barbeiro, data, hora, criadoEm: new Date().toISOString() };
    
    try {
        await salvarAgendamentoFirestore(agendamento);
        if (resultadoEl) {
            resultadoEl.innerText = 'Agendado com sucesso! Abrindo WhatsApp...';
            resultadoEl.style.color = 'green';
        }
        await renderPainel();
        await onDataChange(); 
        setTimeout(() => abrirWhatsAppComAgendamento(agendamento), 500);
    } catch (err) {
        console.error(err);
        if (resultadoEl) {
            resultadoEl.innerText = 'Erro ao salvar agendamento! Verifique o Console (F12) para detalhes.';
            resultadoEl.style.color = 'red';
        }
    }
}

function abrirWhatsAppComAgendamento(a) {
    const telefoneBarbearia = "5585988338580";
    const dataBR = new Date(a.data + 'T00:00:00').toLocaleDateString('pt-BR');
    const serv = SERVICOS[a.servico] || { preco: 0, duracao: 0 };
    
    const msg = encodeURIComponent(
`Olá! Gostaria de confirmar meu agendamento:
Nome: ${a.nome}
Telefone: ${a.telefone}
Serviço: ${a.servico}
Preço: R$${serv.preco}
Duração: ${serv.duracao} minutos
Barbeiro: ${a.barbeiro}
Data: ${dataBR}
Horário: ${a.hora}`);

    window.open(`https://wa.me/${telefoneBarbearia}?text=${msg}`, "_blank");
}

/* painel */
async function renderPainel() {
    if (!listaEl) return;
    const ags = (await loadAgendamentos()).sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
    listaEl.innerHTML = "";
    
    // Simplificando o painel, a exclusão usará o ID para buscar os slots
    ags.forEach(a => {
        const div = document.createElement('div');
        div.className = 'item-agendamento';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        div.style.padding = '8px';
        div.style.borderBottom = '1px solid #ffffff10';
        
        const dataBR = new Date(a.data + 'T00:00:00').toLocaleDateString('pt-BR');
        const info = document.createElement('div');
        info.className = 'item-info';
        const duracao = a.slots_consumidos ? (a.slots_consumidos * INTERVALO_MIN) : SERVICOS[a.servico]?.duracao || 30;
        info.innerHTML = `<strong>${a.nome}</strong><br>${a.barbeiro}<br>${a.servico} (${duracao}min)<br>${dataBR} — ${a.hora}`;
        
        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '6px';
        
        const btnWhats = document.createElement('button');
        btnWhats.innerText = 'Whats';
        btnWhats.addEventListener('click', () => abrirWhatsAppComAgendamento(a));
        actions.appendChild(btnWhats);
        
        if (isAdmin()) {
            const btnDel = document.createElement('button');
            btnDel.innerText = 'Excluir';
            btnDel.style.background = '#ff4d4d';
            btnDel.style.color = '#fff';
            
            btnDel.addEventListener('click', async () => {
                if (!confirm('Excluir agendamento? Ele liberará todos os slots consumidos. Confirma?')) return;
                await excluirAgendamentoFirestore(a.id);
                await renderPainel();
                onDataChange();
            });
            actions.appendChild(btnDel);
        }
        div.appendChild(info);
        div.appendChild(actions);
        listaEl.appendChild(div);
    });
}

async function loadAgendamentos() {
    if (!db) { return []; }
    try {
        const snap = await getDocs(collection(db, "agendamentos"));
        const lista = [];
        snap.forEach(d => lista.push(d.data()));
        return lista;
    } catch (err) {
        console.error('Erro loadAgendamentos', err);
        return [];
    }
}

/* ADMIN */
function isAdmin() { return sessionStorage.getItem(ADMIN_SESSION_KEY) === "1"; }
function adminLoginFlow() {
    if (isAdmin()) return true;
    const senha = prompt("Senha de administrador:");
    if (senha === ADMIN_PASSWORD) { sessionStorage.setItem(ADMIN_SESSION_KEY, "1"); renderPainel(); return true; }
    alert("Senha incorreta."); return false;
}
function togglePainel() { 
    if (!painel) return; 
    painel.style.display = (painel.style.display === 'block') ? 'none' : 'block'; 
}
function adminAbrirPainel() { 
    if (isAdmin()) togglePainel(); 
    else if (adminLoginFlow()) togglePainel(); 
}
// expõe toggleInfo para o index.html
window.toggleInfo = (id) => {
    if (id === 'painelAgendamentos') return togglePainel();
    // Lógica para info-box da página index.html
};


// ===============================================
// STARTUP DO AGENDAMENTO
// ===============================================
function initAgendamento() {
    (async () => {
        if (!dataInput) {
            // Não é a página de agendamento, apenas executa o fundo de partículas
            return; 
        }

        await waitForFirebase(); 
        
        const hoje = new Date();
        dataInput.min = hoje.toISOString().split('T')[0];
        
        if (!dataInput.value) {
            dataInput.value = dataInput.min;
        }

        // Adiciona Listeners
        dataInput.addEventListener('change', onDataChange);
        if (servicoSelect) servicoSelect.addEventListener('change', onDataChange);
        
        if (btnConfirm) btnConfirm.addEventListener('click', onConfirmar);
        if (btnAbrirPainel) btnAbrirPainel.addEventListener('click', adminAbrirPainel);

        // Setup inicial
        popularServicos();
        setupBarbeiroSelection();

        const firstCard = document.querySelector(".barbeiro-card");
        if (firstCard && !barbeiroInput.value) {
            firstCard.classList.add("selecionado");
            barbeiroInput.value = (firstCard.getAttribute("data-barbeiro")||'').trim();
        }
        
        await renderPainel();
        if (dataInput && dataInput.value && barbeiroInput && barbeiroInput.value) {
            onDataChange();
        }
        
        // Coloca o cursor no nome após 1 segundo
        setTimeout(() => { nomeInput?.focus(); }, 1000);

    })();
}


// ===============================================
// FUNÇÕES GERAIS (NETWORK DE PARTÍCULAS E START)
// ===============================================

/* sua função initFundoNetwork (mantida) */
function initFundoNetwork() {
    (function () {
        const canvas = document.getElementById("fundoParticulas");
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        let w = window.innerWidth, h = window.innerHeight;
        const quantidade = 90;
        let particles = [];
        function ajustarCanvas() { w = window.innerWidth; h = window.innerHeight; canvas.width = w; canvas.height = h; }
        function criar() { particles = []; for (let i = 0; i < quantidade; i++) particles.push({ x: Math.random()*w, y: Math.random()*h, vx:(Math.random()-0.5)*0.6, vy:(Math.random()-0.5)*0.6, size:2 }); }
        function animar() {
            ctx.clearRect(0,0,w,h);
            particles.forEach((p, idx) => {
                p.x += p.vx; p.y += p.vy;
                if (p.x < 0 || p.x > w) p.vx *= -1;
                if (p.y < 0 || p.y > h) p.vy *= -1;
                ctx.fillStyle = "rgba(255,255,255,0.8)";
                ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
                for (let j = idx+1; j < particles.length; j++) {
                    const p2 = particles[j];
                    const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
                    if (dist < 150) {
                        ctx.strokeStyle = "rgba(255,255,255," + ((1 - dist/150)*0.3) + ")";
                        ctx.lineWidth = 1;
                        ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p2.x,p2.y); ctx.stroke();
                    }
                }
            });
            requestAnimationFrame(animar);
        }
        ajustarCanvas(); criar(); animar();
        window.addEventListener("resize", () => { ajustarCanvas(); criar(); });
    })();
}

/* START */
document.addEventListener('DOMContentLoaded', () => {
    initAgendamento();
    initFundoNetwork();
});

// ===============================================
// PAINEL ADMINISTRATIVO UNIFICADO (ABRE TUDO)
// ===============================================

/*window.adminAbrirPainel = function() {
    const senha = prompt("Senha de administrador:");
    
    if (senha === "mkadmin135") {
        // Localiza os elementos
        const pAgendamentos = document.getElementById('painelAgendamentos');
        const pControleDias = document.getElementById('adminBlocker');

        // Abre os dois painéis IMEDIATAMENTE
        if (pAgendamentos) pAgendamentos.style.display = 'block';
        if (pControleDias) pControleDias.style.display = 'block';

        // Carrega os dados de ambos do Firebase
        renderPainel();
        window.atualizarListaDiasBloqueados();
        
        // Rola a tela suavemente para as ferramentas de gestão
        pControleDias.scrollIntoView({ behavior: 'smooth' });
    } else {
        alert("Senha incorreta! Acesso negado.");
    }
};*/

// Gerencia a lista visual de dias bloqueados (com o botão verde REMOVER)
window.atualizarListaDiasBloqueados = async function() {
    await loadBlockedDays(); 
    const container = document.getElementById('blocked-days-list');
    if (!container) return;
    
    container.innerHTML = "";
    if (blockedDaysCache.length === 0) {
        container.innerHTML = "<p style='font-size:12px; color:#aaa; text-align:center;'>Nenhum dia bloqueado.</p>";
        return;
    }

    blockedDaysCache.sort().forEach(dataStr => {
        const itemDiv = document.createElement('div');
        itemDiv.style = "display:flex; justify-content:space-between; align-items:center; background:#001a33; padding:10px; border-radius:6px; margin-bottom:8px; border:1px solid #ffffff10;";
        
        const dataBR = dataStr.split('-').reverse().join('/');
        
        itemDiv.innerHTML = `
            <span style="color:#fff; font-size:14px; font-weight:bold;">${dataBR}</span>
            <button style="background:#28a745; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:bold;" 
                    onclick="window.unblockDay('${dataStr}')">
                REMOVER
            </button>
        `;
        container.appendChild(itemDiv);
    });
};

// Função para bloquear o dia
window.blockDay = async function(dateString) {
    if (!dateString) return;
    try {
        await setDoc(doc(db, "dias_bloqueados", dateString), {
            data: dateString,
            bloqueado_em: new Date().toISOString()
        });
        if(!blockedDaysCache.includes(dateString)) blockedDaysCache.push(dateString);
        
        await window.atualizarListaDiasBloqueados();
        onDataChange(); 
        alert("Dia bloqueado!");
    } catch (e) { console.error(e); }
};

// Função para desbloquear o dia
window.unblockDay = async function(dateString) {
    if (!confirm(`Deseja liberar o dia ${dateString.split('-').reverse().join('/')}?`)) return;
    try {
        await deleteDoc(doc(db, "dias_bloqueados", dateString));
        blockedDaysCache = blockedDaysCache.filter(d => d !== dateString);
        await window.atualizarListaDiasBloqueados();
        onDataChange();
    } catch (e) { console.error(e); }
};

// Acionador do botão vermelho no HTML
window.handleAdminDayBlock = async function (action) {
    const input = document.getElementById('block-date-input');
    if (action === 'block' && input && input.value) {
        await window.blockDay(input.value);
        input.value = ""; 
    }
};

// ===============================================
// ABERTURA SEPARADA DOS PAINÉIS (SEM CONFLITO)
// ===============================================

window.abrirPainelAgendamentos = async function () {
    if (!isAdmin()) {
        const senha = prompt("Senha de administrador:");
        if (senha !== ADMIN_PASSWORD) {
            alert("Senha incorreta!");
            return;
        }
        sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
    }

    const painel = document.getElementById('painelAgendamentos');
    if (painel) {
        painel.style.display = 'block';
        await renderPainel();
        painel.scrollIntoView({ behavior: 'smooth' });
    }
};

window.abrirControleDias = async function () {
    if (!isAdmin()) {
        const senha = prompt("Senha de administrador:");
        if (senha !== ADMIN_PASSWORD) {
            alert("Senha incorreta!");
            return;
        }
        sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
    }

    const painel = document.getElementById('adminBlocker');
    if (!painel) {
        alert("Painel de controle de dias não encontrado no HTML");
        return;
    }

    painel.style.display = 'block';

    // ✅ ESSA LINHA É A CHAVE DO PROBLEMA
    await window.atualizarListaDiasBloqueados();

    painel.scrollIntoView({ behavior: 'smooth' });
};


