import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  databaseURL: "https://blay-8ae65-default-rtdb.firebaseio.com/"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let myPlayerName = "";
let currentRoomId = null;
let isHost = false;

// إنشاء معرف فريد للجلسة الحالية لمنع الانتحال والسيطرة على الحساب
const mySessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);

// -------------------------------------------------------------
// 1. إنشاء الغرفة والانضمام الحصري
// -------------------------------------------------------------

window.createRoom = async function () {
  const nameInput = document.getElementById('username');
  const name = nameInput ? nameInput.value.trim() : "";

  if (!name) return alert('الرجاء كتابة اسمك أولاً!');

  myPlayerName = name;
  const roomId = Math.floor(1000 + Math.random() * 9000).toString();
  currentRoomId = roomId;
  isHost = true;

  try {
    const roomRef = ref(db, 'rooms/' + roomId);

    await set(roomRef, {
      status: 'LOBBY',
      phase: 'NIGHT',
      round: 1,
      host: myPlayerName,
      lastHealed: "",
      nightActions: { mafiaTarget: "", doctorTarget: "", detectiveTarget: "" },
      votes: {},
      readyToResolveDay: {},
      nightResultMsg: "",
      players: {
        [myPlayerName]: { name: name, role: "", alive: true, sessionId: mySessionId }
      }
    });

    listenToRoom(roomId);
    showScreen('lobby-screen');

    const hostControls = document.getElementById('host-controls');
    if (hostControls) hostControls.classList.remove('hidden');

  } catch (error) {
    console.error("Firebase Error:", error);
    alert("حدث خطأ أثناء إنشاء الغرفة: " + error.message);
  }
};

window.joinRoom = async function () {
  const nameInput = document.getElementById('username');
  const roomInput = document.getElementById('room-code-input');
  
  const name = nameInput ? nameInput.value.trim() : "";
  const roomId = roomInput ? roomInput.value.trim() : "";

  if (!name || !roomId) return alert('الرجاء إدخال الاسم ورقم الغرفة!');

  try {
    const roomSnap = await get(ref(db, 'rooms/' + roomId));
    if (!roomSnap.exists()) return alert('الغرفة غير موجودة!');

    const roomData = roomSnap.val();
    const players = roomData.players || {};

    // 1. التعديل التقني: منع الأسماء المتشابهة في نفس الغرفة (إغلاق ثغرة المسافات والحروف الكبيرة/الصغيرة)
    const normalizedNewName = name.toLowerCase().replace(/\s+/g, '');
    let existingPlayerKey = null;

    Object.keys(players).forEach(pKey => {
      if (pKey.toLowerCase().replace(/\s+/g, '') === normalizedNewName) {
        existingPlayerKey = pKey;
      }
    });

    // إذا كانت اللعبة في اللوبي وتمت محاولة إدخال اسم موجود بنفس الصيغة أو متشابه
    if (roomData.status === 'LOBBY') {
      if (existingPlayerKey) {
        return alert('هذا الاسم (أو اسم مشابه له) مستخدم بالفعل داخل الغرفة! اختر اسماً آخر.');
      }

      // إضافة اللاعب بسلام
      myPlayerName = name;
      await update(ref(db, `rooms/${roomId}/players/${myPlayerName}`), {
        name: name,
        role: "",
        alive: true,
        sessionId: mySessionId
      });
    }

    // 2. التعديل الأمني أثناء اللعب (PLAYING) لضبط الغش وطرد الجلسة القديمة
    if (roomData.status === 'PLAYING') {
      if (!existingPlayerKey) {
        return alert('اللعبة بدأت بالفعل! لا يمكنك الانضمام باسم جديد حتى ينتهي القيم الحالي.');
      }

      // تم كشف محاولة دخول باسم لاعب موجود: طرد الجلسة القديمة واستبدالها بالجلسة الجديدة فوراً
      myPlayerName = existingPlayerKey;
      
      await update(ref(db, `rooms/${roomId}/players/${myPlayerName}`), {
        sessionId: mySessionId
      });

      alert(`⚠️ تنبيه أمني: تم تسجيل الدخول باسم (${myPlayerName}) وطرد الجلسة السابقة المفتوحة للتحقق من الغش!`);
    }

    currentRoomId = roomId;
    if (roomData.host === myPlayerName) isHost = true;

    listenToRoom(roomId);

  } catch (error) {
    console.error("Firebase Error:", error);
    alert("حدث خطأ أثناء الانضمام: " + error.message);
  }
};

window.goBackToMain = async function () {
  if (currentRoomId && myPlayerName) {
    try {
      const roomSnap = await get(ref(db, 'rooms/' + currentRoomId));
      if (roomSnap.exists() && roomSnap.val().status === 'LOBBY') {
        await remove(ref(db, `rooms/${currentRoomId}/players/${myPlayerName}`));
      }
    } catch (e) {
      console.log("Error leaving room:", e);
    }
  }
  currentRoomId = null;
  isHost = false;
  showScreen('login-screen');
};

// -------------------------------------------------------------
// 2. إدارة الشاشات والاستماع للتحديثات والمراقبة الأمنية
// -------------------------------------------------------------

function showScreen(screenId) {
  const screens = ['login-screen', 'lobby-screen', 'game-screen', 'end-screen'];
  screens.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(screenId);
  if (target) target.classList.remove('hidden');
}

function listenToRoom(roomId) {
  const roomRef = ref(db, 'rooms/' + roomId);
  onValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    // المراقبة الأمنية للجلسة: إذا تم طردك بسبب دخول شخص آخر بنفس الاسم
    if (myPlayerName && data.players && data.players[myPlayerName]) {
      const activeSession = data.players[myPlayerName].sessionId;
      if (activeSession && activeSession !== mySessionId) {
        alert('🚨 تم طردك من الغرفة! قام شخص آخر بتسجيل الدخول باسمك من جهاز أو متصفح آخر للكشف عن التلاعب.');
        currentRoomId = null;
        isHost = false;
        showScreen('login-screen');
        return;
      }
    }

    document.getElementById('display-room-code').innerText = roomId;

    if (data.status === 'LOBBY') {
      showScreen('lobby-screen');
      const list = document.getElementById('players-list');
      if (list && data.players) {
        list.innerHTML = '';
        Object.keys(data.players).forEach(pName => {
          list.innerHTML += `<li>👤 ${pName}</li>`;
        });
      }
      
      if (data.host === myPlayerName) {
        isHost = true;
        const hostControls = document.getElementById('host-controls');
        if (hostControls) hostControls.classList.remove('hidden');
      } else {
        const waitingMsg = document.getElementById('waiting-msg');
        if (waitingMsg) waitingMsg.classList.remove('hidden');
      }
    }

    if (data.status === 'PLAYING') {
      showScreen('game-screen');
      const myData = data.players ? data.players[myPlayerName] : null;

      if (myData) {
        const myRole = myData.role;
        const roleElement = document.getElementById('my-role');
        
        if (roleElement) {
          roleElement.innerText = myRole + (!myData.alive ? ' (ميت 💀)' : '');
        }

        setRoleDescription(myRole);

        const avengerBox = document.getElementById('avenger-box');
        if (avengerBox) {
          if (myRole === 'منتقم' && myData.alive && data.phase === 'DAY_VOTE') {
            avengerBox.classList.remove('hidden');
          } else {
            avengerBox.classList.add('hidden');
          }
        }
      }

      checkAutoNightResolve(data);
      checkAutoDayResolve(data);

      checkWinCondition(data);
      renderGameUI(data);
    }

    if (data.status === 'ENDED') {
      showEndGameUI(data);
    }
  });
}

// -------------------------------------------------------------
// 3. بدء اللعبة وتوزيع الأدوار
// -------------------------------------------------------------

window.startGame = async function () {
  if (!isHost) return;

  try {
    const roomSnap = await get(ref(db, 'rooms/' + currentRoomId));
    const roomData = roomSnap.val();
    const playerNames = Object.keys(roomData.players);

    if (playerNames.length < 3) {
      return alert('يجب توفر 3 لاعبين على الأقل لبدء اللعبة!');
    }

    const mafiaCount = parseInt(document.getElementById('mafia-count').value) || 1;
    const hasDoctor = document.getElementById('has-doctor').checked;
    const hasDetective = document.getElementById('has-detective').checked;
    const hasAvenger = document.getElementById('has-avenger').checked;

    let rolesPool = [];
    for (let i = 0; i < mafiaCount; i++) rolesPool.push('مافيا');
    if (hasDoctor) rolesPool.push('طبيب');
    if (hasDetective) rolesPool.push('محقق');
    if (hasAvenger) rolesPool.push('منتقم');

    while (rolesPool.length < playerNames.length) {
      rolesPool.push('مواطن');
    }

    for (let i = rolesPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rolesPool[i], rolesPool[j]] = [rolesPool[j], rolesPool[i]];
    }

    const updates = {};
    playerNames.forEach((name, index) => {
      updates[`rooms/${currentRoomId}/players/${name}/role`] = rolesPool[index];
      updates[`rooms/${currentRoomId}/players/${name}/alive`] = true;
    });

    updates[`rooms/${currentRoomId}/status`] = 'PLAYING';
    updates[`rooms/${currentRoomId}/phase`] = 'NIGHT';
    updates[`rooms/${currentRoomId}/round`] = 1;
    updates[`rooms/${currentRoomId}/lastHealed`] = "";
    updates[`rooms/${currentRoomId}/nightActions`] = { mafiaTarget: "", doctorTarget: "", detectiveTarget: "" };
    updates[`rooms/${currentRoomId}/votes`] = {};
    updates[`rooms/${currentRoomId}/readyToResolveDay`] = {};
    updates[`rooms/${currentRoomId}/nightResultMsg`] = "";

    await update(ref(db), updates);

  } catch (error) {
    console.error("Firebase Start Error:", error);
    alert("حدث خطأ أثناء توزيع الأدوار: " + error.message);
  }
};

function setRoleDescription(role) {
  const box = document.getElementById('role-description');
  if (!box) return;

  if (role === 'مافيا') box.innerText = 'أنت مافيا 🔪: اختر شخصاً واحداً لتصفيتها في الليل.';
  else if (role === 'طبيب') box.innerText = 'أنت الطبيب 💊: اختر شخصاً لحمايته في الليل (لا يمكنك علاج نفس الشخص مرتين متتاليتين).';
  else if (role === 'محقق') box.innerText = 'أنت المحقق 🔍: اسأل عن شخص واحد لمعرفة هويته.';
  else if (role === 'منتقم') box.innerText = 'أنت المنتقم 💣: يمكنك استبعاد نفسك وشخص آخر معك وإلغاء التصويت في الجولة.';
  else box.innerText = 'أنت مواطن بريء 😇: انتظر الليل وناقش ورشح المشتبه بهم في النهار.';
}

// -------------------------------------------------------------
// 4. واجهة اللعب
// -------------------------------------------------------------

function renderGameUI(roomData) {
  const container = document.getElementById('game-players-list');
  if (!container) return;
  container.innerHTML = '';

  const me = roomData.players ? roomData.players[myPlayerName] : null;
  const isAlive = me && me.alive;
  const myRole = me ? me.role : "";
  const nightActions = roomData.nightActions || {};
  const votes = roomData.votes || {};
  const currentVote = votes[myPlayerName] || null;
  const readyMap = roomData.readyToResolveDay || {};

  const votersForPlayer = {};
  Object.entries(votes).forEach(([voterName, targetName]) => {
    if (!votersForPlayer[targetName]) votersForPlayer[targetName] = [];
    votersForPlayer[targetName].push(voterName);
  });

  let titleText = roomData.phase === 'NIGHT' 
    ? `🌙 الجولة ${roomData.round}: مرحلة الليل (في انتظار أدوار الليل...)` 
    : `☀️ الجولة ${roomData.round}: مرحلة التصويت النهاري`;

  container.innerHTML = `<h3>${titleText}</h3>`;

  if (roomData.phase === 'DAY_VOTE' && roomData.nightResultMsg) {
    container.innerHTML += `
      <div style="background-color: #fff3cd; color: #856404; padding: 12px; border-radius: 8px; margin-bottom: 15px; font-weight: bold; text-align: center;">
        📢 أحداث الليل: ${roomData.nightResultMsg}
      </div>
    `;
  }

  const mafiaDone = !!nightActions.mafiaTarget;
  const doctorDone = !!nightActions.doctorTarget;
  const detectiveDone = !!nightActions.detectiveTarget;

  Object.entries(roomData.players).forEach(([pName, player]) => {
    if (!player.alive) {
      container.innerHTML += `
        <div class="player-card dead" style="border: 1px solid #ccc; padding: 10px; border-radius: 8px; margin-bottom: 10px; background-color: #f8f9fa; opacity: 0.6;">
          <span>💀 ${pName} (ميت)</span>
        </div>
      `;
      return;
    }

    let actionBtn = '';

    if (isAlive) {
      if (roomData.phase === 'NIGHT') {
        if (myRole === 'مافيا' && player.role !== 'مافيا') {
          actionBtn = mafiaDone 
            ? `<button disabled style="opacity: 0.6;">تم اختيار القتل ✔️</button>`
            : `<button onclick="window.mafiaKill('${pName}')">تصفية 🔪</button>`;
        } else if (myRole === 'طبيب') {
          actionBtn = doctorDone 
            ? `<button disabled style="opacity: 0.6;">تم اختيار الحماية ✔️</button>`
            : `<button onclick="window.healPlayer('${pName}', '${roomData.lastHealed || ''}')">حماية 💊</button>`;
        } else if (myRole === 'محقق' && pName !== myPlayerName) {
          actionBtn = detectiveDone 
            ? `<button disabled style="opacity: 0.6;">تم الفحص ✔️</button>`
            : `<button onclick="window.checkPlayer('${pName}', '${player.role}')">فحص 🔍</button>`;
        }
      } else if (roomData.phase === 'DAY_VOTE' && pName !== myPlayerName) {
        const isVotedThis = currentVote === pName;
        actionBtn = `<button onclick="window.votePlayer('${pName}')" style="background-color: ${isVotedThis ? '#28a745' : '#007bff'}; color: white;">
          ${isVotedThis ? 'تم تصويتك له ✔️' : 'تصويت 🗳️'}
        </button>`;
      }
    }

    let votersHTML = '';
    if (roomData.phase === 'DAY_VOTE') {
      const list = votersForPlayer[pName] || [];
      if (list.length > 0) {
        votersHTML = `<div style="font-size: 0.85em; color: #dc3545; margin-top: 5px;">🗳️ المصوتون ضده: <strong>${list.join(', ')}</strong></div>`;
      } else {
        votersHTML = `<div style="font-size: 0.85em; color: #6c757d; margin-top: 5px;">لا توجد أصوات ضده حتى الآن</div>`;
      }
    }

    container.innerHTML += `
      <div class="player-card" style="border: 2px solid ${currentVote === pName ? '#28a745' : '#ddd'}; padding: 12px; border-radius: 8px; margin-bottom: 10px; background-color: #fff;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 1.1em; font-weight: bold; color: #212529;">👤 ${pName}</span>
          ${actionBtn}
        </div>
        ${votersHTML}
      </div>
    `;
  });

  if (isAlive && roomData.phase === 'DAY_VOTE') {
    const isSkipped = currentVote === 'SKIP';
    const skipVoters = votersForPlayer['SKIP'] || [];
    let skipVotersHTML = skipVoters.length > 0 ? `<br><small style="color: #6c757d;">المصوتون للتخطي: ${skipVoters.join(', ')}</small>` : '';

    container.innerHTML += `
      <div style="margin-top: 15px; text-align: center;">
        <button onclick="window.votePlayer('SKIP')" style="background-color: ${isSkipped ? '#6c757d' : '#e2e3e5'}; color: ${isSkipped ? '#fff' : '#000'}; padding: 10px 20px;">
          ${isSkipped ? 'تم اختيار تخطي التصويت ✔️' : 'تخطي التصويت ⏭️'}
        </button>
        ${skipVotersHTML}
      </div>
    `;

    const aliveCount = Object.values(roomData.players).filter(p => p.alive).length;
    const readyCount = Object.keys(readyMap).length;
    const myReady = !!readyMap[myPlayerName];

    container.innerHTML += `
      <hr>
      <div style="text-align: center; margin-top: 20px;">
        <button onclick="window.toggleReadyDayResolve()" class="${myReady ? 'voted-btn' : 'btn-danger'}" style="padding: 12px 24px; font-weight: bold;">
          ${myReady ? `في انتظار البقية... (${readyCount}/${aliveCount}) ✔️` : `موافق على إنهاء التصويت وحسم النتيجة (${readyCount}/${aliveCount}) 🗳️`}
        </button>
      </div>
    `;
  }

  if (roomData.phase === 'NIGHT' && roomData.host === myPlayerName) {
    container.innerHTML += `
      <hr style="border-color: rgba(255,255,255,0.2); margin-top: 20px;">
      <button onclick="window.forceResolveNight()" style="background-color: #ff9f1c; color: #000; border: none; padding: 10px; border-radius: 8px; font-weight: bold; cursor: pointer;">
        ⚡ إنهاء الليل والتصويت فوراً (خاص بالهوست)
      </button>
    `;
  }
}

// -------------------------------------------------------------
// 5. حسم الأدوار والتصويت والتعادل
// -------------------------------------------------------------

window.mafiaKill = async function (targetName) {
  await update(ref(db, `rooms/${currentRoomId}/nightActions`), { mafiaTarget: targetName });
  alert(`تم اختيار (${targetName}) لقتله!`);
};

window.healPlayer = async function (targetName, lastHealed) {
  if (lastHealed && targetName === lastHealed) {
    return alert('لا يمكنك علاج نفس الشخص مرتين متتاليتين!');
  }
  await update(ref(db, `rooms/${currentRoomId}/nightActions`), { doctorTarget: targetName });
  alert(`تم اختيار (${targetName}) لحمايته!`);
};

window.checkPlayer = async function (targetName, targetRole) {
  await update(ref(db, `rooms/${currentRoomId}/nightActions`), { detectiveTarget: targetName });

  const resBox = document.getElementById('action-result');
  if (resBox) {
    resBox.classList.remove('hidden');
    resBox.innerText = targetRole === 'مافيا' 
      ? `نتيجة فحص (${targetName}): ينتمي إلى (المافيا 🔴)`
      : `نتيجة فحص (${targetName}): شخص (بريء 🟢)`;
  }
};

async function checkAutoNightResolve(roomData) {
  if (roomData.phase !== 'NIGHT') return;

  const actions = roomData.nightActions || {};
  const players = roomData.players || {};

  let hasMafia = false, mafiaDone = false;
  let hasDoctor = false, doctorDone = false;
  let hasDetective = false, detectiveDone = false;

  Object.values(players).forEach(p => {
    if (p.alive) {
      if (p.role === 'مافيا') { hasMafia = true; if (actions.mafiaTarget) mafiaDone = true; }
      if (p.role === 'طبيب') { hasDoctor = true; if (actions.doctorTarget) doctorDone = true; }
      if (p.role === 'محقق') { hasDetective = true; if (actions.detectiveTarget) detectiveDone = true; }
    }
  });

  const mafiaOk = !hasMafia || mafiaDone;
  const doctorOk = !hasDoctor || doctorDone;
  const detectiveOk = !hasDetective || detectiveDone;

  const isRealHost = (roomData.host === myPlayerName);

  if (mafiaOk && doctorOk && detectiveOk && isRealHost) {
    await resolveNightPhase(roomData);
  }
}

async function resolveNightPhase(roomData) {
  const actions = roomData.nightActions || {};
  const updates = {};
  let resultText = "مرت الليلة بهدوء ولم يمت أحد!";

  if (actions.mafiaTarget) {
    if (actions.doctorTarget && actions.mafiaTarget === actions.doctorTarget) {
      resultText = `حاولت المافيا قتل (${actions.mafiaTarget})، ولكن الطبيب قام بحمايته بنجاح! 💊`;
    } else {
      updates[`rooms/${currentRoomId}/players/${actions.mafiaTarget}/alive`] = false;
      resultText = `تمت تصفية اللاعب (${actions.mafiaTarget}) خلال الليل! 💀`;
    }
  }

  updates[`rooms/${currentRoomId}/lastHealed`] = actions.doctorTarget || "";
  updates[`rooms/${currentRoomId}/phase`] = 'DAY_VOTE';
  updates[`rooms/${currentRoomId}/nightResultMsg`] = resultText;
  updates[`rooms/${currentRoomId}/nightActions`] = { mafiaTarget: "", doctorTarget: "", detectiveTarget: "" };

  await update(ref(db), updates);
}

window.forceResolveNight = async function() {
  if (!currentRoomId) return;
  const roomSnap = await get(ref(db, 'rooms/' + currentRoomId));
  if (roomSnap.exists()) {
    await resolveNightPhase(roomSnap.val());
  }
};

window.votePlayer = async function (targetName) {
  if (!currentRoomId || !myPlayerName) return alert('خطأ في بيانات الجلسة!');

  try {
    const updates = {};
    updates[`rooms/${currentRoomId}/votes/${myPlayerName}`] = targetName;
    updates[`rooms/${currentRoomId}/readyToResolveDay/${myPlayerName}`] = null;

    await update(ref(db), updates);

    if (targetName === 'SKIP') {
      alert('تم تغيير/تسجيل اختيارك: تخطي التصويت!');
    } else {
      alert(`تم تغيير/تسجيل تصويتك ضد (${targetName}) بنجاح!`);
    }
  } catch (error) {
    console.error("Vote Error:", error);
    alert("حدث خطأ أثناء التصويت: " + error.message);
  }
};

window.toggleReadyDayResolve = async function () {
  const roomSnap = await get(ref(db, 'rooms/' + currentRoomId));
  const roomData = roomSnap.val();

  const votes = roomData.votes || {};
  if (!votes[myPlayerName]) {
    return alert('أنت لم تصوت أو تتخطى بعد، صوت أولاً!');
  }

  const readyMap = roomData.readyToResolveDay || {};
  if (readyMap[myPlayerName]) {
    await remove(ref(db, `rooms/${currentRoomId}/readyToResolveDay/${myPlayerName}`));
  } else {
    await update(ref(db, `rooms/${currentRoomId}/readyToResolveDay`), { [myPlayerName]: true });
  }
};

async function checkAutoDayResolve(roomData) {
  if (roomData.phase !== 'DAY_VOTE') return;

  const alivePlayers = Object.entries(roomData.players || {}).filter(([_, p]) => p.alive);
  const readyMap = roomData.readyToResolveDay || {};

  const allReady = alivePlayers.length > 0 && alivePlayers.every(([pName, _]) => readyMap[pName] === true);
  const isRealHost = (roomData.host === myPlayerName);

  if (allReady && isRealHost) {
    const votes = roomData.votes || {};
    const voteCounts = {};

    Object.values(votes).forEach(targetName => {
      voteCounts[targetName] = (voteCounts[targetName] || 0) + 1;
    });

    let maxVotes = 0;
    let topTargets = [];

    Object.entries(voteCounts).forEach(([name, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        topTargets = [name];
      } else if (count === maxVotes) {
        topTargets.push(name);
      }
    });

    const updates = {};

    // معالجة التعادل: عدم إقصاء أحد إذا تساوت أعلى الأصوات
    if (topTargets.length === 1 && topTargets[0] !== 'SKIP') {
      const eliminatedName = topTargets[0];
      updates[`rooms/${currentRoomId}/players/${eliminatedName}/alive`] = false;
    }

    updates[`rooms/${currentRoomId}/phase`] = 'NIGHT';
    updates[`rooms/${currentRoomId}/round`] = (roomData.round || 1) + 1;
    updates[`rooms/${currentRoomId}/votes`] = {};
    updates[`rooms/${currentRoomId}/readyToResolveDay`] = {};

    await update(ref(db), updates);
  }
}

// -------------------------------------------------------------
// التعديل: استخدام قوة المنتقم واستبعاد الشخص المختار + إنهاء التصويت فوراً
// -------------------------------------------------------------
window.useAvengerPower = async function () {
  const targetName = prompt('أدخل اسم الشخص الذي تريد أخذه معك واستبعاده فوراً:');
  if (!targetName) return;

  try {
    const roomSnap = await get(ref(db, 'rooms/' + currentRoomId));
    const roomData = roomSnap.val();

    if (roomData.phase !== 'DAY_VOTE') {
      return alert('يمكنك استخدام هذه القدرة فقط أثناء مرحلة التصويت!');
    }

    const me = roomData.players[myPlayerName];
    if (!me || !me.alive) {
      return alert('لا يمكنك استخدام القدرة لأنك ميت!');
    }

    if (!roomData.players[targetName] || !roomData.players[targetName].alive) {
      return alert('الاسم غير صحيح أو أن الشخص ميت بالفعل!');
    }

    if (targetName === myPlayerName) {
      return alert('لا يمكنك اختيار نفسك!');
    }

    const updates = {};

    // 1. استبعاد المنتقم والهدف المحدد
    updates[`rooms/${currentRoomId}/players/${myPlayerName}/alive`] = false;
    updates[`rooms/${currentRoomId}/players/${targetName}/alive`] = false;

    // 2. إلغاء التصويت النهاري فوراً والانتقال المباشر إلى مرحلة الليل
    updates[`rooms/${currentRoomId}/phase`] = 'NIGHT';
    updates[`rooms/${currentRoomId}/round`] = (roomData.round || 1) + 1;
    updates[`rooms/${currentRoomId}/votes`] = {};
    updates[`rooms/${currentRoomId}/readyToResolveDay`] = {};
    updates[`rooms/${currentRoomId}/nightResultMsg`] = `قام المنتقم (${myPlayerName}) بتفعيل قدرته واصطحب معه (${targetName}) وتم إنهاء التصويت لهذه الجولة! 💣`;

    await update(ref(db), updates);
    alert(`تم استخدام قوة المنتقم! تم استبعادك واستبعاد (${targetName}) معك وانتهى التصويت! 💣`);

  } catch (error) {
    console.error("Avenger Error:", error);
    alert("حدث خطأ أثناء استخدام القدرة: " + error.message);
  }
};

// -------------------------------------------------------------
// 6. شاشة النهاية
// -------------------------------------------------------------

function checkWinCondition(roomData) {
  if (roomData.status !== 'PLAYING') return;

  let aliveMafia = 0;
  let aliveInnocents = 0;

  Object.values(roomData.players).forEach(p => {
    if (p.alive) {
      if (p.role === 'مافيا') aliveMafia++;
      else aliveInnocents++;
    }
  });

  if (aliveMafia === 0) {
    update(ref(db, `rooms/${currentRoomId}`), { status: 'ENDED', winner: 'المواطنين 🏆' });
  } else if (aliveMafia >= aliveInnocents) {
    update(ref(db, `rooms/${currentRoomId}`), { status: 'ENDED', winner: 'المافيا 🔴' });
  }
}

function showEndGameUI(roomData) {
  showScreen('end-screen');

  const winnerEl = document.getElementById('winner-team');
  if (winnerEl) winnerEl.innerText = roomData.winner || 'اللعبة انتهت';

  const rolesContainer = document.getElementById('revealed-roles-list');
  if (rolesContainer && roomData.players) {
    rolesContainer.innerHTML = '';
    Object.entries(roomData.players).forEach(([pName, pData]) => {
      rolesContainer.innerHTML += `
        <div class="role-reveal-item" style="padding: 8px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between;">
          <span>👤 <strong>${pName}</strong></span>
          <span class="badge-role" style="font-weight: bold; color: #d9534f;">${pData.role}</span>
        </div>
      `;
    });
  }
}

window.resetGameToLobby = async function () {
  if (!currentRoomId) return;

  try {
    const roomSnap = await get(ref(db, 'rooms/' + currentRoomId));
    const roomData = roomSnap.val();

    const updates = {};
    Object.keys(roomData.players).forEach(pName => {
      updates[`rooms/${currentRoomId}/players/${pName}/role`] = "";
      updates[`rooms/${currentRoomId}/players/${pName}/alive`] = true;
    });

    updates[`rooms/${currentRoomId}/status`] = 'LOBBY';
    updates[`rooms/${currentRoomId}/phase`] = 'NIGHT';
    updates[`rooms/${currentRoomId}/round`] = 1;
    updates[`rooms/${currentRoomId}/lastHealed`] = "";
    updates[`rooms/${currentRoomId}/votes`] = {};
    updates[`rooms/${currentRoomId}/readyToResolveDay`] = {};
    updates[`rooms/${currentRoomId}/nightActions`] = { mafiaTarget: "", doctorTarget: "", detectiveTarget: "" };

    await update(ref(db), updates);

  } catch (error) {
    console.error("Reset Error:", error);
    alert("حدث خطأ أثناء إعادة اللعبة: " + error.message);
  }
};

// -------------------------------------------------------------
// 7. ربط الأحداث بالأزرار ضماناً للعمل على GitHub Pages
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const btnCreate = document.getElementById('btn-create');
  const btnJoin = document.getElementById('btn-join');
  const btnStartGame = document.getElementById('btn-start-game');
  const btnLeaveRoom = document.getElementById('btn-leave-room');
  const btnUseAvenger = document.getElementById('btn-use-avenger');
  const btnResetLobby = document.getElementById('btn-reset-lobby');

  if (btnCreate) btnCreate.addEventListener('click', window.createRoom);
  if (btnJoin) btnJoin.addEventListener('click', window.joinRoom);
  if (btnStartGame) btnStartGame.addEventListener('click', window.startGame);
  if (btnLeaveRoom) btnLeaveRoom.addEventListener('click', window.goBackToMain);
  if (btnUseAvenger) btnUseAvenger.addEventListener('click', window.useAvengerPower);
  if (btnResetLobby) btnResetLobby.addEventListener('click', window.resetGameToLobby);
});