let authToken = null;
let userProfile = null;
let simulatedReferralCode = "";

// Initialize page elements on boot
document.addEventListener('DOMContentLoaded', () => {
  // Activate Lucide icons rendering
  lucide.createIcons();
});

// Toast notification trigger
function showToast(title, desc, type = 'success') {
  const toastRoot = document.getElementById('toast-root');
  const toast = document.getElementById('toast');
  
  let icon = 'info';
  let color = 'text-blue-400';
  if (type === 'success') {
    icon = 'check-circle';
    color = 'text-emerald-400';
  } else if (type === 'error') {
    icon = 'alert-triangle';
    color = 'text-red-400';
  }

  toast.innerHTML = `
    <div class="${color} mt-0.5">
      <i data-lucide="${icon}" class="w-5 h-5"></i>
    </div>
    <div>
      <h5 class="text-xs font-bold text-white">${title}</h5>
      <p class="text-[10px] text-slate-400 mt-0.5 leading-relaxed">${desc}</p>
    </div>
  `;
  
  lucide.createIcons();
  
  toastRoot.classList.remove('hidden');
  setTimeout(() => {
    toastRoot.classList.add('hidden');
  }, 4000);
}

// Simulated referral code setter
function applySimulatedReferral() {
  const input = document.getElementById('ref-simulate-code');
  if (!input.value.trim()) {
    showToast('Referral Error', 'Please enter a valid referral code', 'error');
    return;
  }
  simulatedReferralCode = input.value.trim();
  showToast('Referral Queued', `The invite code "${simulatedReferralCode}" will be applied upon account log in.`, 'success');
}

// 1. Core Telegram mini-app login simulation
async function simulateTgLogin(userId, username, firstName, lastName) {
  const payload = {
    startapp: simulatedReferralCode
  };

  // We craft a clean mock of headers representing Telegram's secure Mini App signature
  const mockInitData = `user=${encodeURIComponent(JSON.stringify({
    id: userId,
    username: username,
    first_name: firstName,
    last_name: lastName,
    language_code: "en"
  }))}&hash=mocked_dev_hash_verification_passed`;

  try {
    const res = await fetch('/api/user/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': mockInitData
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.error) {
       showToast('Authentication Failed', data.error, 'error');
       return;
    }

    // Save tokens and session states
    authToken = data.token;
    userProfile = data.user;

    // Refresh top badge indicators
    const simBadge = document.getElementById('sim-t-badge');
    simBadge.innerText = (userProfile.username ? userProfile.username.slice(0, 3) : "USR").toUpperCase();
    simBadge.classList.add('bg-emerald-600', 'border-emerald-400');

    // Hide Auth section, activate dashboard
    document.getElementById('auth-box').classList.add('hidden');
    document.getElementById('user-profile-widget').classList.remove('hidden');
    document.getElementById('pages-container').classList.remove('hidden');
    document.getElementById('bottom-tabs').classList.remove('hidden');

    showToast('Success', `Authenticated as @${userProfile.username}!`, 'success');

    // Load home assets and data
    updateProfileView();
    loadTasks();
    loadLedger();

  } catch (err) {
    showToast('Connection Refused', 'Unable to reach backend Oibb server', 'error');
  }
}

// 2. Refresh UI widgets and profiles
function updateProfileView() {
  if (!userProfile) return;
  document.getElementById('user-balance').innerText = userProfile.balance.toLocaleString();
  document.getElementById('user-earned').innerText = userProfile.totalEarned.toLocaleString();
  document.getElementById('user-ref-count').innerText = userProfile.referralCount.toLocaleString();
  
  // Set referral link
  const botLink = `https://t.me/OibbBot/app?startapp=${userProfile.referralCode}`;
  document.getElementById('ref-link-field').value = botLink;
}

// 3. Page switching router
function switchTab(tabName, element) {
  // Hide all view pages
  document.querySelectorAll('.view-page').forEach(page => page.classList.add('hidden'));
  // Show active page
  document.getElementById(`page-${tabName}`).classList.remove('hidden');

  // Deactivate all button highlights
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.add('text-slate-400');
    btn.classList.remove('text-[#2481cc]');
  });

  // Activate active button
  element.classList.remove('text-slate-400');
  element.classList.add('text-[#2481cc]');
}

// 4. Fetch and display campaigns
async function loadTasks() {
  if (!authToken) return;

  const tasksContainer = document.getElementById('tasks-list');

  try {
    const res = await fetch('/api/tasks', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    const tasks = await res.json();

    if (!tasks || tasks.length === 0) {
      tasksContainer.innerHTML = `
        <div class="py-8 text-center text-slate-500 text-xs font-semibold uppercase">
          No current campaigns found
        </div>
      `;
      return;
    }

    tasksContainer.innerHTML = tasks.map(task => {
      const typeIcons = {
        channel_join: 'navigation-2',
        visit_website: 'globe',
        watch_ad: 'play-circle',
        social_follow: 'twitter',
        daily_login: 'calendar'
      };

      const btnStyles = task.completed 
        ? 'bg-slate-800 text-slate-500 border border-slate-700/60 cursor-not-allowed pointer-events-none'
        : 'bg-[#2481cc]/15 text-[#2481cc] border border-[#2481cc]/25 hover:bg-[#2481cc]/25';

      return `
        <div class="bg-slate-800/60 border border-slate-700/40 rounded-xl p-4 flex items-center justify-between gap-4 transition hover:bg-slate-800">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center text-slate-400">
              <i data-lucide="${typeIcons[task.taskType] || 'award'}" class="w-5 h-5"></i>
            </div>
            <div>
              <h4 class="text-xs font-bold text-white">${task.title}</h4>
              <p class="text-[10px] text-amber-400 font-extrabold mt-0.5">Reward: +${task.reward} 🪙</p>
            </div>
          </div>

          <div class="flex flex-col gap-1.5 items-end">
            ${task.completed ? `
              <span class="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                <i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Claimed
              </span>
            ` : `
              <a href="${task.taskUrl}" target="_blank" onclick="claimTaskReward('${task.id}')" class="${btnStyles} text-[10px] font-extrabold px-3.5 py-1.5 rounded-lg text-center transition tracking-wide uppercase">
                Claim Reward
              </a>
            `}
          </div>
        </div>
      `;
    }).join('');

    lucide.createIcons();

  } catch (err) {
    tasksContainer.innerHTML = `
      <div class="py-8 text-center text-red-400 text-xs font-bold">
        Failed to load tasks list
      </div>
    `;
  }
}

// 5. Send campaign claim requests
async function claimTaskReward(taskId) {
  if (!authToken) return;

  // Immediate local feedback so it registers completion
  showToast('Campaign Opened', 'Verifying engagement constraints on backend...', 'success');

  setTimeout(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/claim`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      const data = await res.json();
      
      if (data.error) {
        showToast('Claim Failed', data.error, 'error');
        return;
      }

      showToast('Reward Claimed!', data.message, 'success');
      
      // Update balance and refresh
      syncProfileData();
      loadTasks();
      loadLedger();
    } catch (err) {
      showToast('Error', 'Unable to complete reward verification', 'error');
    }
  }, 1200);
}

// Helper to pull fresh user profiles
async function syncProfileData() {
  if (!authToken) return;
  try {
    const res = await fetch('/api/user/profile', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    userProfile = await res.json();
    updateProfileView();
  } catch (e) {}
}

// 6. Claim check-in bonus
async function claimDailyBonus() {
  if (!authToken) return;

  try {
    const res = await fetch('/api/user/checkin', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();

    if (data.error) {
       showToast('Bonus Expired', data.error, 'error');
       return;
    }

    showToast('Bonus Earned!', data.message, 'success');
    syncProfileData();
    loadLedger();

  } catch (err) {
    showToast('Failed', 'Endpoint request rejected check-in', 'error');
  }
}

// 7. Copy referral link
function copyReferralLink() {
  const field = document.getElementById('ref-link-field');
  field.select();
  navigator.clipboard.writeText(field.value);
  
  const label = document.getElementById('copy-success-p');
  label.classList.remove('hidden');
  
  showToast('Copied!', 'Your unique referral link was copied!', 'success');
  
  setTimeout(() => {
    label.classList.add('hidden');
  }, 3000);
}

// 8. Submit cashout withdrawals
async function handleWithdrawalSubmit(e) {
  e.preventDefault();
  if (!authToken) return;

  const method = document.getElementById('w-method').value;
  const address = document.getElementById('w-address').value;
  const amount = parseInt(document.getElementById('w-amount').value);

  if (amount < 100) {
    showToast('Minimum Required', 'Minimum redemption starts at 100 coins', 'error');
    return;
  }

  if (amount > userProfile.balance) {
    showToast('Insufficient Coins', 'Your bank is short of the requested amount', 'error');
    return;
  }

  try {
    const res = await fetch('/api/user/withdraw', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ amount, method, address })
    });
    const data = await res.json();

    if (data.error) {
      showToast('Validation Error', data.error, 'error');
      return;
    }

    showToast('Payout Requested', 'Withdrawal request filed under pending state!', 'success');
    
    // Clear form inputs
    document.getElementById('w-address').value = "";
    document.getElementById('w-amount').value = "";

    syncProfileData();
    loadLedger();

  } catch (err) {
    showToast('Error', 'Redemption system server refused', 'error');
  }
}

// 9. Load transactions list
async function loadLedger() {
  if (!authToken) return;
  const ledgerContainer = document.getElementById('history-list');

  try {
    const res = await fetch('/api/user/transactions', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const txs = await res.json();

    if (!txs || txs.length === 0) {
      ledgerContainer.innerHTML = `
        <div class="py-8 text-center text-slate-500 text-xs font-semibold uppercase">
          Ledger is currently empty
        </div>
      `;
      return;
    }

    ledgerContainer.innerHTML = txs.map(tx => {
      const isPositive = tx.amount > 0;
      const amtColor = isPositive ? 'text-emerald-400' : 'text-rose-400';
      const indicator = isPositive ? '+' : '';
      
      const categoryNames = {
        daily_checkin: 'Daily Login Reward',
        referral_comm: 'Invitation Reward',
        referral_sign_up: 'Registration Welcome Reward',
        withdrawal_hold: 'Withdraw Hold Processing',
        withdrawal_success: 'Withdraw Successfully Dispatched',
        withdrawal_refund: 'Withdraw Refund Recycled',
        task_channel_join: 'Telegram Channel Join Payout',
        task_watch_ad: 'Watch Video Ads Payout',
        task_visit_website: 'Visit Partner Website Payout',
        task_social_follow: 'Social Media engagement Payout'
      };

      const dateStr = new Date(tx.createdAt).toLocaleString(undefined, { 
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
      });

      return `
        <div class="bg-slate-800/40 border border-slate-700/30 rounded-xl p-3.5 flex items-center justify-between gap-4 transition hover:bg-slate-850">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs font-bold text-white">${categoryNames[tx.type] || tx.type}</span>
            <span class="text-[10px] text-slate-500">${dateStr}</span>
          </div>
          <span class="mono-text text-sm font-extrabold ${amtColor}">${indicator}${tx.amount.toLocaleString()} 🪙</span>
        </div>
      `;
    }).join('');

  } catch (err) {
    ledgerContainer.innerHTML = `
      <div class="py-8 text-center text-red-500 text-xs font-semibold">
        Error reading account ledger logs
      </div>
    `;
  }
}
