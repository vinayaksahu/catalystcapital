/**
 * Catalyst Capital & BNV Mobile WebApp Engine
 * Fully unified frontend client supporting 5-tab mobile-first experience:
 * 1. Home (BNV Trading UI)
 * 2. Quotes (Interactive Plan Presentation)
 * 3. Team (Network & Genealogy)
 * 4. History (Bonus -> History Ledger)
 * 5. Assets (Assets & Wallets in USDT)
 */

const API_BASE = '/api';
let currentUser = null;
let token = localStorage.getItem('catalyst_token') || null;
let allPlans = [];
let userWallets = null;
let currentHistoryFilter = 'all';

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  initThemeMode();
  lucide.createIcons();
  setupEventListeners();
  initTabSliderControls('sr-tabs-container');
  initTabSliderControls('admin-tabs-container');

  // Load official investment plans
  await loadPlans();

  // Load public announcements (ticker and pop image) immediately
  await loadPublicAnnouncements();

  // Authenticate current user or direct to login page
  if (token) {
    await fetchUserProfile();
  } else {
    updateAuthUI();
    const urlParams = new URLSearchParams(window.location.search);
    const path = window.location.pathname.toLowerCase().replace(/\/+$/, '');
    const ref = urlParams.get('ref');
    const action = urlParams.get('action');

    if (path === '/superrootadminlogin' || path === '/superadminlogin') {
      navigate('superrootadminlogin');
    } else if (path === '/adminlogin') {
      navigate('adminlogin');
    } else if (ref || action === 'register' || path === '/register') {
      navigate('register');
    } else {
      navigate('login');
    }
  }

  // Start live crypto price pulse
  startCryptoTickerPulse();

  // Background poller for real-time notifications & admin alerts (every 15s)
  setInterval(() => {
    if (token && currentUser) {
      loadNotificationBadge();
      if (activeViewName === 'admin' && (currentUser.role === 'admin' || currentUser.role === 'superadmin')) {
        loadAdminData();
      }
    }
  }, 15000);

  // Initialize interactive calendar and team stats immediately
  renderInteractiveCalendar();
  if (teamStatsCache) updateTeamUIWithStats(teamStatsCache);
});

// Cache for public announcements
let publicAnnouncementsCache = null;

async function loadPublicAnnouncements() {
  try {
    const res = await fetch(`${API_BASE}/auth/announcements?t=${Date.now()}`);
    const data = await res.json();
    if (data.success) {
      publicAnnouncementsCache = data;
      // Update scrolling ticker text immediately in header
      if (data.announcementTicker) {
        const tickerEl = document.getElementById('home-ticker-text');
        if (tickerEl) tickerEl.textContent = data.announcementTicker;
      }
      // If popup is active and has an image, trigger popup (works for both members and admin previewing member portal)
      if (data.popupImageActive && data.popupImageUrl) {
        checkAndShowMemberLoginPopup(data.popupImageUrl, data.popupImageTitle);
      }
      // Sync platform deposit address immediately on load
      if (data.depositAddress) {
        updateRechargeModalAddress(data.depositAddress);
      }
    }
  } catch (e) {
    console.warn('Failed to load announcements:', e);
  }
}
window.loadPublicAnnouncements = loadPublicAnnouncements;

// ==================== THEME MANAGEMENT (Dark / Light Mode) ====================

function initThemeMode() {
  const savedTheme = localStorage.getItem('catalyst_theme') || 'dark';
  applyTheme(savedTheme);
}

function toggleThemeMode() {
  const isDark = document.documentElement.classList.contains('dark');
  const nextTheme = isDark ? 'light' : 'dark';
  applyTheme(nextTheme);
  showToast(`Switched to ${nextTheme === 'dark' ? 'Dark' : 'Light'} Mode`, 'info');
}

function applyTheme(theme) {
  const iconContainer = document.getElementById('theme-toggle-btn');
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
    if (iconContainer) {
      iconContainer.innerHTML = '<i data-lucide="sun" class="w-4 h-4 text-amber-500"></i>';
    }
  } else {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
    if (iconContainer) {
      iconContainer.innerHTML = '<i data-lucide="moon" class="w-4 h-4 text-slate-700"></i>';
    }
  }
  localStorage.setItem('catalyst_theme', theme);
  lucide.createIcons();
}

// Setup global event listeners
function setupEventListeners() {
  const urlParams = new URLSearchParams(window.location.search);
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, '');
  const hash = window.location.hash.toLowerCase();
  const action = urlParams.get('action');
  const view = urlParams.get('view');
  const ref = urlParams.get('ref');

  if (ref) {
    const regSponsor = document.getElementById('reg-sponsor');
    if (regSponsor) regSponsor.value = ref;
  }

  if (path === '/superrootadminlogin' || path === '/superadminlogin') {
    navigate('superrootadminlogin');
  } else if (path === '/adminlogin') {
    navigate('adminlogin');
  } else if (ref || action === 'register' || hash === '#register' || path === '/register') {
    navigate('register');
  } else if (action === 'login' || hash === '#login' || path === '/login') {
    navigate('login');
  } else if (action === 'admin' || view === 'admin' || hash === '#admin' || path === '/admin') {
    navigate('admin');
  }

  // Handle browser back and forward navigation
  window.addEventListener('popstate', (e) => {
    const state = e.state;
    if (state && state.view) {
      navigate(state.view, false);
    } else {
      const currentParams = new URLSearchParams(window.location.search);
      const currPath = window.location.pathname.toLowerCase().replace(/\/+$/, '');
      const currRef = currentParams.get('ref');
      const currAction = currentParams.get('action');
      const currView = currentParams.get('view');

      if (currPath === '/superrootadminlogin' || currPath === '/superadminlogin') {
        navigate('superrootadminlogin', false);
      } else if (currPath === '/adminlogin') {
        navigate('adminlogin', false);
      } else if (currPath === '/register' || currRef || currAction === 'register') {
        navigate('register', false);
      } else if (currPath === '/login' || currAction === 'login') {
        navigate('login', false);
      } else if (currPath === '/admin' || currView === 'admin' || currAction === 'admin') {
        navigate('admin', false);
      } else {
        navigate('home', false);
      }
    }
  });

  // Close profile dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const profileDropdown = document.getElementById('crypto-profile-dropdown');
    const profileBtn = document.getElementById('profile-pill-btn');
    if (profileDropdown && !profileDropdown.classList.contains('hidden')) {
      if (!profileDropdown.contains(e.target) && !profileBtn?.contains(e.target)) {
        closeProfileDropdown();
      }
    }
  });
}

// ==================== CRYPTOFINANCE PROFILE DROPDOWN (Uploaded Image) ====================

function toggleProfileDropdown(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('crypto-profile-dropdown');
  const chevron = document.getElementById('profile-chevron-icon');
  if (!dropdown) return;

  const isHidden = dropdown.classList.contains('hidden');
  if (isHidden) {
    dropdown.classList.remove('hidden');
    if (chevron) {
      chevron.setAttribute('data-lucide', 'chevron-up');
      lucide.createIcons();
    }
  } else {
    closeProfileDropdown();
  }
}

function closeProfileDropdown() {
  const dropdown = document.getElementById('crypto-profile-dropdown');
  const chevron = document.getElementById('profile-chevron-icon');
  if (dropdown) dropdown.classList.add('hidden');
  if (chevron) {
    chevron.setAttribute('data-lucide', 'chevron-down');
    lucide.createIcons();
  }
}

function openEditProfileModal() {
  closeProfileDropdown();
  if (!currentUser) return;
  const uidEl = document.getElementById('edit-prof-uid');
  if (uidEl) uidEl.textContent = currentUser.referral_code || 'CF163205';
  const userEl = document.getElementById('edit-prof-username');
  if (userEl) userEl.textContent = `@${currentUser.username}`;
  const fullEl = document.getElementById('edit-prof-fullname');
  if (fullEl) fullEl.value = currentUser.full_name || '';
  const phoneEl = document.getElementById('edit-prof-phone');
  if (phoneEl) phoneEl.value = currentUser.phone || '';
  const emailEl = document.getElementById('edit-prof-email');
  if (emailEl) emailEl.value = currentUser.email || '';
  
  // Reset OTP container and status
  const otpContainer = document.getElementById('edit-prof-otp-container');
  if (otpContainer) otpContainer.classList.add('hidden');
  const otpInput = document.getElementById('edit-prof-otp');
  if (otpInput) {
    otpInput.value = '';
    otpInput.required = false;
  }
  const sendBtn = document.getElementById('btn-edit-prof-send-otp');
  if (sendBtn) {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send OTP';
  }
  const oldEmailDisp = document.getElementById('edit-prof-old-email-display');
  if (oldEmailDisp) oldEmailDisp.textContent = currentUser.email || '';

  const emailBadge = document.getElementById('edit-prof-email-badge');
  if (emailBadge) {
    emailBadge.innerHTML = '<i data-lucide="shield-check" class="w-3 h-3 text-emerald-400"></i> Verified';
    emailBadge.className = 'text-[10px] text-emerald-400 font-mono flex items-center gap-1';
  }

  openModal('editProfileModal');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function handleEditProfileEmailChange() {
  if (!currentUser) return;
  const emailEl = document.getElementById('edit-prof-email');
  const currentVal = (emailEl?.value || '').trim().toLowerCase();
  const originalVal = (currentUser.email || '').trim().toLowerCase();
  const otpContainer = document.getElementById('edit-prof-otp-container');
  const otpInput = document.getElementById('edit-prof-otp');
  const emailBadge = document.getElementById('edit-prof-email-badge');

  if (currentVal !== originalVal) {
    // Email has changed -> show OTP box
    if (otpContainer) otpContainer.classList.remove('hidden');
    if (otpInput) otpInput.required = true;
    if (emailBadge) {
      emailBadge.innerHTML = '<i data-lucide="alert-triangle" class="w-3 h-3 text-amber-400"></i> Change Pending';
      emailBadge.className = 'text-[10px] text-amber-400 font-mono flex items-center gap-1';
    }
  } else {
    // Reverted back to original -> hide OTP box
    if (otpContainer) otpContainer.classList.add('hidden');
    if (otpInput) {
      otpInput.value = '';
      otpInput.required = false;
    }
    if (emailBadge) {
      emailBadge.innerHTML = '<i data-lucide="shield-check" class="w-3 h-3 text-emerald-400"></i> Verified';
      emailBadge.className = 'text-[10px] text-emerald-400 font-mono flex items-center gap-1';
    }
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.handleEditProfileEmailChange = handleEditProfileEmailChange;

async function handleSendEmailChangeOtp() {
  if (!currentUser) return;
  const btn = document.getElementById('btn-edit-prof-send-otp');
  const oldEmail = currentUser.email;
  const statusEl = document.getElementById('edit-prof-otp-status');

  if (!oldEmail) {
    showToast('No registered email found to send OTP', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i><span>Sending...</span>';
    if (window.lucide) lucide.createIcons();
  }

  try {
    const res = await fetch(`${API_BASE}/auth/email/send-change-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Security OTP sent to your registered email (${oldEmail})! Check inbox/spam.`, 'success');
      if (statusEl) statusEl.classList.remove('hidden');
      if (btn) {
        btn.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i><span>OTP Sent</span>';
        if (window.lucide) lucide.createIcons();
      }
      // 60-second cooldown timer
      let countdown = 60;
      const interval = setInterval(() => {
        countdown--;
        if (countdown > 0) {
          if (btn) btn.innerHTML = `<span>Resend (${countdown}s)</span>`;
        } else {
          clearInterval(interval);
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i><span>Send OTP</span>';
            if (window.lucide) lucide.createIcons();
          }
        }
      }, 1000);
    } else {
      showToast(data.error || 'Failed to send OTP to old email', 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i><span>Send OTP</span>';
        if (window.lucide) lucide.createIcons();
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i><span>Send OTP</span>';
      if (window.lucide) lucide.createIcons();
    }
  }
}
window.handleSendEmailChangeOtp = handleSendEmailChangeOtp;

async function handleUpdateProfile(e) {
  e.preventDefault();
  const fullName = (document.getElementById('edit-prof-fullname')?.value || '').trim();
  const phone = (document.getElementById('edit-prof-phone')?.value || '').trim();
  const email = (document.getElementById('edit-prof-email')?.value || '').trim();
  const otp = (document.getElementById('edit-prof-otp')?.value || '').trim();

  // If email was changed, check that OTP was entered
  if (currentUser && email.toLowerCase() !== (currentUser.email || '').toLowerCase()) {
    if (!otp) {
      showToast('Please enter the 6-digit OTP code sent to your old registered email', 'error');
      const otpInput = document.getElementById('edit-prof-otp');
      if (otpInput) otpInput.focus();
      return;
    }
  }

  const saveBtn = document.getElementById('btn-save-profile');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    const res = await fetch(`${API_BASE}/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ fullName, phone, email, otp })
    });
    const data = await res.json();
    if (data.success && data.user) {
      currentUser = data.user;
      updateAuthUI();
      closeModal('editProfileModal');
      showToast('Profile updated successfully!', 'success');
    } else {
      showToast(data.error || 'Failed to update profile', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  }
}

function openChangePasswordModal() {
  closeProfileDropdown();
  const cpCurr = document.getElementById('cp-current');
  if (cpCurr) cpCurr.value = '';
  const cpNew = document.getElementById('cp-new');
  if (cpNew) cpNew.value = '';
  const cpConf = document.getElementById('cp-confirm');
  if (cpConf) cpConf.value = '';
  openModal('changePasswordModal');
}

async function handleChangePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('cp-current').value;
  const newPassword = document.getElementById('cp-new').value;
  const confirmPassword = document.getElementById('cp-confirm').value;

  if (newPassword !== confirmPassword) {
    showToast('New passwords do not match!', 'error');
    return;
  }
  if (newPassword.length < 6) {
    showToast('Password must be at least 6 characters long', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json();
    if (data.success) {
      closeModal('changePasswordModal');
      showToast('Password updated successfully!', 'success');
    } else {
      showToast(data.error || 'Failed to update password', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openWalletAddressModal() {
  closeProfileDropdown();
  const dispEl = document.getElementById('bep20-current-display');
  if (dispEl) dispEl.textContent = currentUser?.usdt_address || 'Not Set';
  const inpEl = document.getElementById('bep20-address-input');
  if (inpEl) inpEl.value = currentUser?.usdt_address || '';
  const otpInp = document.getElementById('bep20-otp-input');
  if (otpInp) otpInp.value = '';
  const btn = document.getElementById('btn-bep20-send-otp');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Get OTP';
  }
  openModal('bep20WalletModal');
}

async function handleSendWalletOtp() {
  const btn = document.getElementById('btn-bep20-send-otp');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/auth/wallet-address/send-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Security OTP sent to your registered email!', 'success');
      if (btn) btn.textContent = 'OTP Sent';
      if (data.debugOtp) {
        const otpInp = document.getElementById('bep20-otp-input');
        if (otpInp) otpInp.value = data.debugOtp;
      }
    } else {
      showToast(data.error || 'Failed to send OTP', 'error');
      if (btn) btn.disabled = false;
    }
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) btn.disabled = false;
  }
}
window.handleSendWalletOtp = handleSendWalletOtp;

async function handleUpdateWalletAddress(e) {
  e.preventDefault();
  const walletAddress = document.getElementById('bep20-address-input').value.trim();
  const otp = document.getElementById('bep20-otp-input')?.value.trim();

  if (!walletAddress) {
    showToast('Please enter a valid BEP-20 wallet address', 'error');
    return;
  }
  if (!walletAddress.startsWith('0x') || walletAddress.length < 10) {
    showToast('BEP-20 wallet address must start with 0x', 'error');
    return;
  }
  const isAdmin = currentUser?.role === 'admin' || currentUser?.id === 1;
  if (!isAdmin && !otp) {
    showToast('Please enter the 6-digit OTP code sent to your email', 'error');
    return;
  }

  const saveBtn = document.getElementById('btn-save-wallet');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    const res = await fetch(`${API_BASE}/auth/wallet-address`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ walletAddress, otp })
    });
    const data = await res.json();
    if (data.success && data.user) {
      currentUser = data.user;
      updateAuthUI();
      closeModal('bep20WalletModal');
      const otpInput = document.getElementById('bep20-otp-input');
      if (otpInput) otpInput.value = '';

      // If user is admin, immediately synchronize platform deposit address and UI
      if (isAdmin) {
        updateRechargeModalAddress(walletAddress);
        const adminDepInp = document.getElementById('admin-deposit-address-input');
        if (adminDepInp) adminDepInp.value = walletAddress;
        showToast('BEP-20 Wallet Address & Platform Deposit Address updated successfully!', 'success');
      } else {
        showToast('BEP-20 Wallet Address verified and updated successfully!', 'success');
      }
    } else {
      showToast(data.error || 'Failed to update wallet address', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Verify OTP & Save Address';
    }
  }
}

// ==================== AUTHENTICATION ====================

async function fetchUserProfile() {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success && data.user) {
      currentUser = data.user;
      updateAuthUI();
      await refreshCurrentViewData();
    } else {
      logout();
    }
  } catch (err) {
    console.error('Failed to fetch profile:', err);
    logout();
  }
}

function getAppBaseUrl() {
  if (window.location.origin && window.location.origin.includes('catalystcapital.fit')) {
    return window.location.origin;
  }
  return 'https://www.catalystcapital.fit';
}

function updateAuthUI() {
  const btnLogin = document.getElementById('btn-login-modal');
  const btnProfile = document.getElementById('btn-user-profile');
  const activeBadge = document.getElementById('active-user-badge');

  if (currentUser) {
    if (btnLogin) btnLogin.classList.add('hidden');
    if (btnProfile) btnProfile.classList.remove('hidden');

    const displayName = currentUser.username || currentUser.full_name;
    const initial = (currentUser.full_name || currentUser.username || 'U')[0].toUpperCase();

    const avatarLetter = document.getElementById('user-avatar-initial');
    if (avatarLetter) avatarLetter.textContent = initial;

    const profAvatar = document.getElementById('prof-avatar-letter');
    if (profAvatar) profAvatar.textContent = initial;

    if (activeBadge) activeBadge.textContent = displayName;

    // CryptoFinance Dropdown Information (Uploaded Screenshot)
    const cfUid = document.getElementById('cf-prof-uid');
    if (cfUid) cfUid.textContent = currentUser.referral_code || 'CF163205';

    const cfStatus = document.getElementById('cf-prof-status');
    if (cfStatus) {
      if (currentUser.role === 'superadmin') {
        cfStatus.textContent = 'Active (Super Root Admin)';
      } else if (currentUser.role === 'admin') {
        cfStatus.textContent = 'Active (Team Admin)';
      } else if (currentUser.status === 'active') {
        cfStatus.textContent = 'Active';
      } else {
        cfStatus.textContent = 'Pending Activation';
      }
    }

    const cfAdminLink = document.getElementById('cf-prof-admin-link');
    if (cfAdminLink) {
      if (currentUser.role === 'admin' || currentUser.role === 'superadmin') cfAdminLink.classList.remove('hidden');
      else cfAdminLink.classList.add('hidden');
    }

    // Profile Modal Info
    const profFull = document.getElementById('prof-fullname');
    if (profFull) profFull.textContent = currentUser.full_name || currentUser.username;
    const profUser = document.getElementById('prof-username');
    if (profUser) profUser.textContent = `@${currentUser.username}`;
    const profRef = document.getElementById('prof-refcode');
    if (profRef) profRef.textContent = currentUser.referral_code;
    const profRole = document.getElementById('prof-role');
    if (profRole) profRole.textContent = currentUser.role.toUpperCase();
    const profAddr = document.getElementById('prof-usdt-address');
    if (profAddr) profAddr.textContent = currentUser.usdt_address || 'Not Set';

    // Admin button in profile modal
    const profAdminBtn = document.getElementById('prof-admin-panel-btn');
    if (profAdminBtn) {
      if (currentUser.role === 'admin' || currentUser.role === 'superadmin') profAdminBtn.classList.remove('hidden');
      else profAdminBtn.classList.add('hidden');
    }

    // Referral links
    const refLink = `${getAppBaseUrl()}/register?ref=${currentUser.referral_code}`;
    const teamInput = document.getElementById('team-referral-input');
    if (teamInput) teamInput.value = refLink;
    const modalInput = document.getElementById('modal-ref-input');
    if (modalInput) modalInput.value = refLink;
    const modalCode = document.getElementById('modal-ref-code');
    if (modalCode) modalCode.textContent = currentUser.referral_code;

    // Saved USDT address in withdraw
    const withdrawAddr = document.getElementById('withdraw-address');
    if (withdrawAddr && currentUser.usdt_address) {
      withdrawAddr.value = currentUser.usdt_address;
    }

    // Permanently ensure Profile Avatar Pill in Header is visible across all member and admin views
    const profilePill = document.getElementById('profile-pill-wrapper');
    if (profilePill) {
      if (activeViewName !== 'login' && activeViewName !== 'adminlogin' && activeViewName !== 'superrootadminlogin' && activeViewName !== 'register') {
        profilePill.classList.remove('hidden');
        profilePill.style.removeProperty('display');
      } else {
        profilePill.classList.add('hidden');
      }
    }
  } else {
    if (btnLogin) btnLogin.classList.remove('hidden');
    if (btnProfile) btnProfile.classList.add('hidden');
    const profilePill = document.getElementById('profile-pill-wrapper');
    if (profilePill) profilePill.classList.add('hidden');
    if (activeBadge) activeBadge.textContent = 'Guest';
  }

    // Ensure Admin Portal button in header is strictly hidden for non-admins or logged out users
  const portalBtn = document.getElementById('portal-switch-btn');
  if (portalBtn) {
    if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'superadmin') && activeViewName !== 'login' && activeViewName !== 'adminlogin' && activeViewName !== 'superrootadminlogin' && activeViewName !== 'register') {
      portalBtn.classList.remove('hidden');
      portalBtn.style.removeProperty('display');
    } else {
      portalBtn.classList.add('hidden');
      portalBtn.style.setProperty('display', 'none', 'important');
    }
  }

  // Super Root Impersonation Sticky Bar Handling
  const srOrigToken = localStorage.getItem('catalyst_superadmin_orig_token');
  const srBanner = document.getElementById('super-root-impersonation-bar');
  if (srBanner) {
    if (srOrigToken && currentUser) {
      srBanner.classList.remove('hidden');
      document.body.classList.add('has-sr-impersonation-bar');
      const uEl = document.getElementById('sr-impersonated-user');
      const rEl = document.getElementById('sr-impersonated-role-badge');
      if (uEl) uEl.textContent = `@${currentUser.username}${currentUser.team_name ? ' (' + currentUser.team_name + ')' : ''}`;
      if (rEl) rEl.textContent = `(Role: ${currentUser.role})`;
    } else {
      srBanner.classList.add('hidden');
      document.body.classList.remove('has-sr-impersonation-bar');
    }
  }
}

// Logo click handler: Stays in Admin Portal if admin is in admin portal, else navigates to home
function handleAppLogoClick() {
  if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'superadmin')) {
    if (activeViewName === 'admin') {
      // Already in Admin portal -> reload or scroll to top of admin portal
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
  }
  // For regular members or when in user portal
  if (currentUser) {
    navigate('home');
  } else {
    navigate('login');
  }
}
window.handleAppLogoClick = handleAppLogoClick;

async function quickLogin(username) {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginId: username, password: 'Password@123' })
    });
    const data = await res.json();
    if (data.success) {
      token = data.token;
      currentUser = data.user;
      localStorage.setItem('catalyst_token', token);
      const dropdown = document.getElementById('demo-dropdown');
      if (dropdown) dropdown.classList.add('hidden');
      updateAuthUI();
      showToast(`Switched account to @${currentUser.username} (${currentUser.role})`, 'success');
      await refreshCurrentViewData();
    } else {
      showToast(data.error || 'Demo login failed', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const loginIdInput = document.getElementById('login-id');
  const passwordInput = document.getElementById('login-password');
  const loginId = loginIdInput ? loginIdInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';

  const currentPath = window.location.pathname.toLowerCase().replace(/\/+$/, '');
  const isSuperPortal = (activeViewName === 'superrootadminlogin' || activeViewName === 'superadminlogin' || currentPath === '/superrootadminlogin' || currentPath === '/superadminlogin');
  const isAdminPortal = (activeViewName === 'adminlogin' || currentPath === '/adminlogin');
  const portalType = isSuperPortal ? 'superadmin' : (isAdminPortal ? 'admin' : 'member');

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginId, password, portalType })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Login failed');
    }

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('catalyst_token', token);

    // Reset login popup session flag on fresh login so member sees latest active popup
    hasShownLoginPopupThisSession = false;

    updateAuthUI();
    showToast(`Welcome ${currentUser.full_name || currentUser.username}!`, 'success');
    await refreshCurrentViewData();

    if (currentUser.role === 'admin' || currentUser.role === 'superadmin') {
      navigate('admin');
    } else {
      navigate('home');
      // Trigger pop image check immediately
      if (publicAnnouncementsCache && publicAnnouncementsCache.popupImageActive && publicAnnouncementsCache.popupImageUrl) {
        checkAndShowMemberLoginPopup(publicAnnouncementsCache.popupImageUrl, publicAnnouncementsCache.popupImageTitle);
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleSendRegistrationOtp() {
  const emailInput = document.getElementById('reg-email');
  const email = emailInput ? emailInput.value.trim() : '';
  const btn = document.getElementById('btn-reg-send-otp');

  if (!email || !email.includes('@')) {
    showToast('Please enter a valid email address first', 'error');
    return;
  }

  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, purpose: 'registration' })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Registration OTP sent to your email! Please check inbox/spam.', 'success');
      if (btn) btn.textContent = 'OTP Sent';
    } else {
      showToast(data.error || 'Failed to send OTP', 'error');
      if (btn) btn.disabled = false;
    }
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) btn.disabled = false;
  }
}
window.handleSendRegistrationOtp = handleSendRegistrationOtp;

async function handleRegister(e) {
  e.preventDefault();
  const fullName = (document.getElementById('reg-fullname')?.value || '').trim();
  const email = (document.getElementById('reg-email')?.value || '').trim();
  const sponsorCode = (document.getElementById('reg-sponsor')?.value || '').trim();
  const phone = (document.getElementById('reg-phone')?.value || '').trim();
  const password = document.getElementById('reg-password')?.value || '';
  const otp = (document.getElementById('reg-otp')?.value || '').trim();

  if (!otp) {
    showToast('Please enter the 6-digit Email Verification OTP', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, sponsorCode, phone, password, otp })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Registration failed');
    }

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('catalyst_token', token);

    updateAuthUI();
    showToast(`Account created! Welcome ${currentUser.full_name}. Your User ID: ${data.memberUserId || currentUser.referral_code}`, 'success');
    await refreshCurrentViewData();
    navigate('home');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('catalyst_token');
  updateAuthUI();
  showToast('Logged out successfully', 'info');
  navigate('login');
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  if (btn) {
    btn.innerHTML = isPass ? '<i data-lucide="eye-off" class="w-4 h-4"></i>' : '<i data-lucide="eye" class="w-4 h-4"></i>';
    if (window.lucide) lucide.createIcons();
  }
}
window.togglePasswordVisibility = togglePasswordVisibility;

// ==================== NAVIGATION (5 TABS) ====================

let activeViewName = 'home';

function toggleAdminPortal() {
  if (activeViewName === 'admin') {
    hasShownLoginPopupThisSession = false; // Allow admin to preview pop image as regular user sees it
    navigate('home');
  } else {
    navigate('admin');
  }
}

function navigate(viewName, updateHistory = true) {
  // If user is not logged in, force navigation to login, adminlogin, superrootadminlogin, or register
  if (!token && !currentUser && viewName !== 'login' && viewName !== 'register' && viewName !== 'adminlogin' && viewName !== 'superrootadminlogin' && viewName !== 'superadminlogin') {
    viewName = 'login';
  }

  // Handle specialized admin login modes
  const isSuperAdminLoginMode = (viewName === 'superrootadminlogin' || viewName === 'superadminlogin');
  const isAdminLoginMode = (viewName === 'adminlogin');
  const targetViewKey = (isSuperAdminLoginMode || isAdminLoginMode) ? 'login' : viewName;
  activeViewName = viewName;

  // Update browser URL in address bar if requested
  if (updateHistory) {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (viewName === 'superrootadminlogin' || viewName === 'superadminlogin') {
        window.history.pushState({ view: 'superrootadminlogin' }, '', '/superrootadminlogin');
      } else if (viewName === 'adminlogin') {
        window.history.pushState({ view: 'adminlogin' }, '', '/adminlogin');
      } else if (viewName === 'login') {
        window.history.pushState({ view: 'login' }, '', '/login');
      } else if (viewName === 'register') {
        const ref = urlParams.get('ref') || (document.getElementById('reg-sponsor')?.value || '').trim();
        if (ref) {
          window.history.pushState({ view: 'register' }, '', `/register?ref=${encodeURIComponent(ref)}`);
        } else {
          window.history.pushState({ view: 'register' }, '', '/register');
        }
      } else if (viewName === 'admin') {
        window.history.pushState({ view: 'admin' }, '', '/admin');
      } else if (viewName === 'home') {
        window.history.pushState({ view: 'home' }, '', '/');
      } else {
        window.history.pushState({ view: viewName }, '', `/${encodeURIComponent(viewName)}`);
      }
    } catch (e) {
      console.warn('History pushState error:', e);
    }
  }

  const views = ['home', 'quotes', 'invest', 'team', 'history', 'assets', 'admin', 'login', 'register'];
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.add('hidden');
  });

  const targetView = document.getElementById(`view-${targetViewKey}`);
  if (targetView) targetView.classList.remove('hidden');

  // Toggle admin active class on body for responsive container adaptation
  document.body.classList.toggle('admin-view-active', viewName === 'admin');

  // Configure Login Page presentation based on superrootadminlogin vs adminlogin vs regular login
  const adminBadge = document.getElementById('login-admin-badge');
  const loginTitle = document.getElementById('login-page-title');
  const loginSubtitle = document.getElementById('login-page-subtitle');
  const regSwitch = document.getElementById('login-register-switch-container');
  if (isSuperAdminLoginMode) {
    if (adminBadge) {
      adminBadge.classList.remove('hidden');
      adminBadge.className = 'mb-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 border border-purple-500/40 text-purple-300';
      adminBadge.innerHTML = '<i data-lucide="shield-alert" class="w-3.5 h-3.5 text-purple-400"></i><span>Super Root Administrator</span>';
    }
    if (loginTitle) loginTitle.textContent = 'Super Root Admin Portal';
    if (loginSubtitle) loginSubtitle.textContent = 'Global Platform Architecture & Multi-Team Governance';
    if (regSwitch) regSwitch.classList.add('hidden');
  } else if (isAdminLoginMode) {
    if (adminBadge) {
      adminBadge.classList.remove('hidden');
      adminBadge.className = 'mb-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 border border-amber-500/30 text-amber-400';
      adminBadge.innerHTML = '<i data-lucide="shield-check" class="w-3.5 h-3.5 text-amber-400"></i><span>Team Administrator Portal</span>';
    }
    if (loginTitle) loginTitle.textContent = 'Team Admin Portal';
    if (loginSubtitle) loginSubtitle.textContent = 'Isolated Management Portal for Your Dedicated Team';
    if (regSwitch) regSwitch.classList.add('hidden');
  } else {
    if (adminBadge) adminBadge.classList.add('hidden');
    if (loginTitle) loginTitle.textContent = 'Account Login';
    if (loginSubtitle) loginSubtitle.textContent = 'Sign in to access your investment dashboard';
    if (regSwitch) regSwitch.classList.remove('hidden');
  }

  // Control Header elements and Bottom Nav Bar visibility
  const bottomNav = document.getElementById('global-bottom-nav');
  const profilePill = document.getElementById('profile-pill-wrapper');
  const portalBtn = document.getElementById('portal-switch-btn');

  // Hide bottom menu on auth pages AND when Admin Portal is active
  if (viewName === 'login' || viewName === 'adminlogin' || viewName === 'superrootadminlogin' || viewName === 'register' || viewName === 'admin') {
    if (bottomNav) {
      bottomNav.classList.add('hidden');
      bottomNav.style.setProperty('display', 'none', 'important');
    }
  } else if (currentUser) {
    if (bottomNav) {
      bottomNav.classList.remove('hidden');
      bottomNav.style.removeProperty('display');
    }
  } else {
    if (bottomNav) {
      bottomNav.classList.add('hidden');
      bottomNav.style.setProperty('display', 'none', 'important');
    }
  }

  // Header pill & portal button visibility
  if (viewName === 'login' || viewName === 'adminlogin' || viewName === 'superrootadminlogin' || viewName === 'register') {
    if (profilePill) profilePill.classList.add('hidden');
    if (portalBtn) {
      portalBtn.classList.add('hidden');
      portalBtn.style.setProperty('display', 'none', 'important');
    }
  } else {
    if (currentUser) {
      if (profilePill) profilePill.classList.remove('hidden');
      if (portalBtn) {
        if (currentUser.role === 'admin' || currentUser.role === 'superadmin') {
          portalBtn.classList.remove('hidden');
          portalBtn.style.removeProperty('display');
        } else {
          portalBtn.classList.add('hidden');
          portalBtn.style.setProperty('display', 'none', 'important');
        }
      }
    } else {
      if (profilePill) profilePill.classList.add('hidden');
      if (portalBtn) {
        portalBtn.classList.add('hidden');
        portalBtn.style.setProperty('display', 'none', 'important');
      }
    }
  }

  // Update Portal Switcher Button appearance if admin
  const switchBtn = document.getElementById('portal-switch-btn');
  const switchText = document.getElementById('portal-switch-text');
  const switchIcon = document.getElementById('portal-switch-icon');
  if (switchBtn && switchText) {
    const isActuallyAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'superadmin') && viewName !== 'login' && viewName !== 'register' && viewName !== 'adminlogin' && viewName !== 'superrootadminlogin';
    if (viewName === 'admin') {
      switchText.textContent = 'User Portal';
      switchBtn.className = `px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1.5 shadow-sm transition bg-cyan-500/15 border border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/25 active:scale-95 ${!isActuallyAdmin ? 'hidden' : ''}`.trim();
      if (switchIcon) switchIcon.setAttribute('data-lucide', 'user');
    } else {
      switchText.textContent = 'Admin Portal';
      switchBtn.className = `px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1.5 shadow-sm transition bg-amber-500/15 border border-amber-500/40 text-amber-400 hover:bg-amber-500/25 active:scale-95 ${!isActuallyAdmin ? 'hidden' : ''}`.trim();
      if (switchIcon) switchIcon.setAttribute('data-lucide', 'shield-check');
    }
    if (!isActuallyAdmin) {
      switchBtn.style.setProperty('display', 'none', 'important');
    } else {
      switchBtn.style.removeProperty('display');
    }
    if (window.lucide) lucide.createIcons();
  }

  // Update Bottom Nav Tab styling
  const tabs = ['home', 'quotes', 'team', 'history', 'assets'];
  tabs.forEach(t => {
    const tabEl = document.getElementById(`tab-${t}`);
    if (tabEl) {
      if (t === viewName) {
        tabEl.classList.add('active');
      } else {
        tabEl.classList.remove('active');
      }
    }
  });

  // Refresh view data
  refreshCurrentViewData();

  // If entering home/member portal, check if announcement pop image should be displayed
  if (viewName === 'home') {
    if (publicAnnouncementsCache && publicAnnouncementsCache.popupImageActive && publicAnnouncementsCache.popupImageUrl) {
      checkAndShowMemberLoginPopup(publicAnnouncementsCache.popupImageUrl, publicAnnouncementsCache.popupImageTitle);
    } else {
      loadPublicAnnouncements();
    }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function refreshCurrentViewData() {
  loadNotificationBadge();
  if (activeViewName === 'home') await loadAssetsData();
  if (activeViewName === 'assets') await loadAssetsData();
  if (activeViewName === 'invest') renderPresentationPlans();
  if (activeViewName === 'quotes') renderPresentationPlans();
  if (activeViewName === 'team') await loadTeamData();
  if (activeViewName === 'history') await loadHistoryData();
  if (activeViewName === 'admin') {
    await loadAdminData();
    initTabSliderControls('sr-tabs-container');
    initTabSliderControls('admin-tabs-container');
    setTimeout(() => {
      updateTabSlideArrowStates('sr-tabs-container');
      updateTabSlideArrowStates('admin-tabs-container');
    }, 250);
  }
}

// ==================== VIEW 1: HOME PAGE LOGIC ====================

function startCryptoTickerPulse() {
  let btc = 85129.40;
  let eth = 2700.71;
  let etc = 8.8362;

  setInterval(() => {
    // Random micro fluctuation
    const btcDelta = (Math.random() - 0.48) * 8.5;
    const ethDelta = (Math.random() - 0.48) * 1.2;
    const etcDelta = (Math.random() - 0.49) * 0.01;

    btc = Math.max(84000, btc + btcDelta);
    eth = Math.max(2600, eth + ethDelta);
    etc = Math.max(8.0, etc + etcDelta);

    const btcEl = document.getElementById('home-btc-price');
    const ethEl = document.getElementById('home-eth-price');
    const etcEl = document.getElementById('home-etc-price');

    if (btcEl) btcEl.textContent = `$${btc.toFixed(1)}`;
    if (ethEl) ethEl.textContent = `$${eth.toFixed(2)}`;
    if (etcEl) etcEl.textContent = `$${etc.toFixed(4)}`;

    const listBtc = document.getElementById('list-btc-price');
    const listEth = document.getElementById('list-eth-price');
    if (listBtc) listBtc.textContent = `$${btc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (listEth) listEth.textContent = `$${eth.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, 3500);
}

// Catalyst Guide Modal
function openCatalystGuideModal() {
  openModal('catalystGuideModal');
}
function openBnvGuideModal() {
  openCatalystGuideModal();
}

// Lightbox image viewer for plan and legal certificates
function openImageViewer(src, title) {
  const img = document.getElementById('lightbox-img');
  const titleEl = document.getElementById('lightbox-title');
  if (img) img.src = src;
  if (titleEl && title) titleEl.textContent = title;
  openModal('imageViewerModal');
}

// Open Dedicated Invest tab to see the Investment Packages ($25 - $350)
function openInvestPackages() {
  navigate('invest');
}

function switchTab(viewName) {
  navigate(viewName);
}

window.openInvestPackages = openInvestPackages;
window.switchTab = switchTab;

// Red Envelope Lucky Draw
function openRedEnvelopeModal() {
  const resultBox = document.getElementById('envelope-result');
  const tapBtn = document.getElementById('envelope-tap-btn');
  if (resultBox) resultBox.classList.add('hidden');
  if (tapBtn) {
    tapBtn.disabled = false;
    tapBtn.textContent = '開';
    tapBtn.classList.remove('opacity-50');
  }
  openModal('redEnvelopeModal');
}

async function openLuckyRedEnvelope() {
  const tapBtn = document.getElementById('envelope-tap-btn');
  const resultBox = document.getElementById('envelope-result');
  const prizeText = document.getElementById('envelope-prize-text');

  if (tapBtn) tapBtn.disabled = true;

  // Generate lucky prize between 0.50 and 5.00 USDT
  const prize = (Math.random() * 4.5 + 0.50).toFixed(2);

  if (tapBtn) {
    tapBtn.textContent = '💰';
    tapBtn.classList.add('animate-bounce');
  }

  setTimeout(async () => {
    if (prizeText) prizeText.textContent = `🎉 You won $${prize} USDT!`;
    if (resultBox) resultBox.classList.remove('hidden');

    // Credit bonus in database if logged in
    if (currentUser && token) {
      try {
        await fetch(`${API_BASE}/wallet/deposit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            amount: parseFloat(prize),
            network: 'Red Envelope Bonus',
            txHash: 'LUCKY-' + Math.random().toString(36).substring(2, 8).toUpperCase()
          })
        });
        showToast(`🎉 Claimed +$${prize} USDT Lucky Bonus!`, 'success');
        await fetchUserProfile();
      } catch (err) {
        console.warn('Could not credit lucky bonus:', err);
      }
    }
  }, 1000);
}

let activeDepositAddress = '0x71C87050fA86BD1b297bB3B6a8d6C9081B1A53b5';

function updateRechargeModalAddress(address) {
  if (!address) return;
  activeDepositAddress = address.trim();
  const addrEl = document.getElementById('recharge-address-display');
  if (addrEl) addrEl.textContent = activeDepositAddress;
  const qrEl = document.getElementById('recharge-qr-img');
  if (qrEl) {
    qrEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(activeDepositAddress)}`;
  }
}
window.updateRechargeModalAddress = updateRechargeModalAddress;

function copyRechargeAddress() {
  copyToClipboard(activeDepositAddress);
  showToast('Official Deposit Address copied to clipboard!', 'success');
}
window.copyRechargeAddress = copyRechargeAddress;

async function fetchLatestDepositAddress() {
  try {
    const res = await fetch(`${API_BASE}/wallet/deposit-address?t=${Date.now()}`);
    const data = await res.json();
    if (data.success && data.depositAddress) {
      updateRechargeModalAddress(data.depositAddress);
    }
  } catch (e) {
    // Non-blocking background fetch
  }
}
window.fetchLatestDepositAddress = fetchLatestDepositAddress;

// Quick Circular Actions Handlers
async function openRechargeModal() {
  if (!currentUser) {
    navigate('login');
    return;
  }
  // Immediately render active cached deposit address
  if (activeDepositAddress) {
    updateRechargeModalAddress(activeDepositAddress);
  }
  openModal('rechargeModal');

  // Fetch fresh deposit address on open to guarantee latest admin updated address
  try {
    const res = await fetch(`${API_BASE}/wallet/deposit-address?t=${Date.now()}`);
    const data = await res.json();
    if (data.success && data.depositAddress) {
      updateRechargeModalAddress(data.depositAddress);
    }
  } catch (e) {
    console.error('Error fetching latest deposit address:', e);
  }
}

function openWithdrawModal() {
  if (!currentUser) {
    navigate('login');
    return;
  }
  openModal('withdrawModal');
  loadWithdrawalModalData();
}

function openSignalModal() {
  openModal('signalModal');
}

function openServiceModal() {
  openModal('serviceModal');
}

function openInviteModal() {
  if (!currentUser) {
    navigate('login');
    return;
  }
  openModal('inviteModal');
}

// ==================== MEMBER NOTIFICATIONS SYSTEM ====================

let memberNotificationsCache = [];
let currentNotificationFilter = 'all';

async function loadNotificationBadge() {
  if (!token || !currentUser) return;
  try {
    const res = await fetch(`${API_BASE}/notifications/unread-count`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      updateNotificationBadgeUI(data.unreadCount || 0);
    }
  } catch (err) {
    console.error('Failed to load notification unread count:', err);
  }
}

function updateNotificationBadgeUI(count) {
  const badgeEl = document.getElementById('home-notification-badge');
  if (badgeEl) {
    badgeEl.textContent = count > 99 ? '99+' : count;
    if (count > 0) {
      badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#ff4e91] text-white animate-pulse shadow-sm shadow-[#ff4e91]/40';
      badgeEl.style.removeProperty('display');
    } else {
      badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-700/80 text-slate-400';
    }
  }

  const adminBadgeEl = document.getElementById('admin-notification-badge');
  if (adminBadgeEl) {
    adminBadgeEl.textContent = count > 99 ? '99+' : count;
    if (count > 0) {
      adminBadgeEl.classList.remove('hidden');
      adminBadgeEl.className = 'px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-[#ff4e91] text-white font-mono animate-pulse shadow-sm shadow-[#ff4e91]/40';
    } else {
      adminBadgeEl.classList.add('hidden');
    }
  }
}

async function openNotificationsModal() {
  if (!token || !currentUser) {
    navigate('login');
    return;
  }
  openModal('memberNotificationsModal');
  await fetchUserNotifications();
}
window.openNotificationsModal = openNotificationsModal;

function openNoticeModal() {
  openNotificationsModal();
}
window.openNoticeModal = openNoticeModal;

async function fetchUserNotifications() {
  const listEl = document.getElementById('member-notifications-list');
  if (listEl) {
    listEl.innerHTML = `
      <div class="text-center py-10 text-slate-500 text-xs flex flex-col items-center justify-center">
        <div class="w-6 h-6 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin mb-2"></div>
        <div>Loading notifications...</div>
      </div>
    `;
  }

  try {
    const res = await fetch(`${API_BASE}/notifications?limit=60`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      memberNotificationsCache = data.notifications || [];
      updateNotificationBadgeUI(data.unreadCount || 0);
      renderNotificationsList();
    } else {
      throw new Error(data.error || 'Failed to fetch notifications');
    }
  } catch (err) {
    if (listEl) {
      listEl.innerHTML = `<div class="text-center py-8 text-rose-400 text-xs">${err.message}</div>`;
    }
  }
}

function renderNotificationsList() {
  const listEl = document.getElementById('member-notifications-list');
  if (!listEl) return;

  let items = memberNotificationsCache;
  if (currentNotificationFilter === 'referral') {
    items = items.filter(n => n.type === 'referral');
  } else if (currentNotificationFilter === 'roi') {
    items = items.filter(n => n.type === 'roi');
  } else if (currentNotificationFilter === 'commission') {
    items = items.filter(n => n.type === 'commission' || n.type === 'referral_roi');
  } else if (currentNotificationFilter === 'wallet') {
    items = items.filter(n => n.type === 'deposit' || n.type === 'withdrawal' || n.type === 'adjustment');
  }

  if (items.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-12 text-slate-500 text-xs">
        <i data-lucide="bell-off" class="w-9 h-9 mx-auto mb-2 opacity-30 text-amber-400"></i>
        <div class="font-bold text-slate-400">No ${currentNotificationFilter === 'all' ? '' : currentNotificationFilter} notifications yet</div>
        <div class="text-[11px] text-slate-500 mt-1">Earnings and team activities will appear here in real-time.</div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  listEl.innerHTML = items.map(n => {
    // Style by notification type
    let icon = 'bell';
    let iconBg = 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    let amountColor = 'text-emerald-400';

    if (n.type === 'referral' || n.type === 'user') {
      icon = 'user-plus';
      iconBg = 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    } else if (n.type === 'roi') {
      icon = 'trending-up';
      iconBg = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    } else if (n.type === 'commission' || n.type === 'referral_roi') {
      icon = 'award';
      iconBg = 'bg-purple-500/15 text-purple-400 border-purple-500/30';
      amountColor = 'text-purple-400';
    } else if (n.type === 'deposit') {
      icon = 'arrow-down-left';
      iconBg = 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30';
    } else if (n.type === 'withdrawal') {
      icon = 'arrow-up-right';
      iconBg = 'bg-rose-500/15 text-rose-400 border-rose-500/30';
      amountColor = 'text-rose-400';
    } else if (n.type === 'ticket') {
      icon = 'headphones';
      iconBg = 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    } else if (n.type === 'investment') {
      icon = 'zap';
      iconBg = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    } else if (n.type === 'adjustment') {
      icon = 'sliders';
      iconBg = 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30';
    } else if (n.type === 'welcome') {
      icon = 'sparkles';
      iconBg = 'bg-pink-500/15 text-pink-400 border-pink-500/30';
    }

    const dateStr = n.created_at ? new Date(n.created_at).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }) : '';

    const isUnread = !n.is_read || n.is_read === 0;

    return `
      <div onclick="markSingleNotificationRead(${n.id})" class="p-3 rounded-2xl border transition cursor-pointer ${isUnread ? 'bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/20 border-amber-500/40 shadow-sm' : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-800/60'}">
        <div class="flex items-start gap-3">
          <div class="w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${iconBg}">
            <i data-lucide="${icon}" class="w-4 h-4"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-1 mb-0.5">
              <span class="text-xs font-bold text-white truncate flex items-center gap-1.5">
                ${n.title}
                ${isUnread ? '<span class="w-1.5 h-1.5 rounded-full bg-[#ff4e91] inline-block"></span>' : ''}
              </span>
              ${n.amount ? `<span class="text-xs font-mono font-black ${amountColor}">+$${parseFloat(n.amount).toFixed(2)}</span>` : ''}
            </div>
            <p class="text-[11px] text-slate-300 leading-relaxed font-sans">${n.message || ''}</p>
            <div class="flex items-center justify-between mt-1.5 pt-1 border-t border-slate-800/50">
              <span class="text-[9.5px] font-mono text-slate-500">${dateStr}</span>
              ${n.reference_id ? `<span class="text-[9.5px] font-mono text-slate-500">Ref: ${n.reference_id}</span>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function filterNotifications(filter) {
  currentNotificationFilter = filter;
  document.querySelectorAll('.notif-filter-tab').forEach(tab => {
    tab.className = 'notif-filter-tab px-3 py-1 rounded-full text-[11px] font-bold bg-slate-800 text-slate-300 hover:text-white transition';
  });
  const activeTab = document.getElementById(`notif-tab-${filter}`);
  if (activeTab) {
    activeTab.className = 'notif-filter-tab px-3 py-1 rounded-full text-[11px] font-bold bg-amber-500 text-black transition';
  }
  renderNotificationsList();
}
window.filterNotifications = filterNotifications;

async function markSingleNotificationRead(notifId) {
  const item = memberNotificationsCache.find(n => n.id === notifId);
  if (item && (!item.is_read || item.is_read === 0)) {
    item.is_read = 1;
    renderNotificationsList();
    try {
      await fetch(`${API_BASE}/notifications/${notifId}/read`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      loadNotificationBadge();
    } catch (e) {
      console.error(e);
    }
  }
}
window.markSingleNotificationRead = markSingleNotificationRead;

async function markAllNotificationsRead() {
  if (!token) return;
  try {
    await fetch(`${API_BASE}/notifications/mark-all-read`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    memberNotificationsCache.forEach(n => { n.is_read = 1; });
    renderNotificationsList();
    updateNotificationBadgeUI(0);
    showToast('All notifications marked as read', 'success');
  } catch (err) {
    showToast('Failed to mark read: ' + err.message, 'error');
  }
}
window.markAllNotificationsRead = markAllNotificationsRead;

function openDedicatedSupportModal(type) {
  const title = document.getElementById('service-modal-title');
  if (title) title.textContent = `${type} Dedicated Line`;
  openModal('serviceModal');
}

// Daily check-in
async function claimDailyCheckin() {
  const btn = document.getElementById('btn-daily-checkin');
  if (!currentUser) {
    navigate('login');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Claimed!';
    btn.className = 'px-3 py-1.5 rounded-lg bg-slate-800 text-slate-500 font-bold text-[11px]';
  }

  try {
    await fetch(`${API_BASE}/wallet/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        amount: 0.10,
        network: 'Daily Check-in Reward',
        txHash: 'TASK-' + Date.now()
      })
    });
    showToast('✅ Claimed +$0.10 USDT Daily Check-in Reward!', 'success');
    await fetchUserProfile();
  } catch (e) {
    showToast('Reward claimed for today!', 'info');
  }
}

// ==================== VIEW 2: QUOTES PAGE (Plan Presentation) ====================

async function loadPlans() {
  try {
    const res = await fetch(`${API_BASE}/investments/plans`);
    const data = await res.json();
    if (data.success && data.plans) {
      allPlans = data.plans;
      renderPresentationPlans();
    }
  } catch (err) {
    console.error('Failed to load plans:', err);
  }
}

function renderPresentationPlans() {
  const container = document.getElementById('presentation-plans-grid');
  if (!container || !allPlans || allPlans.length === 0) return;

  container.innerHTML = allPlans.map(p => {
    const totalProfit = p.daily_roi * p.duration_days;
    const profitPercentage = ((totalProfit / p.price) * 100).toFixed(0);

    return `
      <div class="bg-[#11141c] border border-[#1e2434] rounded-2xl p-4 hover:border-[#ff4e91]/60 transition shadow-lg relative overflow-hidden flex flex-col justify-between">
        <!-- Top Tag & Name -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-[#ff4e91]"></span>
            <span class="font-bold text-white text-sm tracking-wide uppercase">${p.name}</span>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            +${profitPercentage}% Return
          </span>
        </div>

        <!-- Price & Duration -->
        <div class="flex items-baseline justify-between my-2 pb-2 border-b border-slate-800">
          <div>
            <span class="text-2xl font-black text-white font-mono">$${p.price}</span>
            <span class="text-xs text-slate-400 font-semibold ml-1">USDT</span>
          </div>
          <div class="text-right">
            <span class="text-xs text-cyan-300 font-bold">${p.duration_days} Days Lock</span>
            <span class="block text-[10px] text-slate-400">Duration</span>
          </div>
        </div>

        <!-- Payout breakdown -->
        <div class="grid grid-cols-2 gap-2 text-xs py-2">
          <div class="bg-black/50 p-2 rounded-lg border border-slate-800/80">
            <span class="text-slate-400 block text-[10px]">Daily ROI:</span>
            <span class="font-bold text-emerald-400 font-mono text-xs">+$${p.daily_roi.toFixed(2)} USDT</span>
          </div>
          <div class="bg-black/50 p-2 rounded-lg border border-slate-800/80">
            <span class="text-slate-400 block text-[10px]">Total Return:</span>
            <span class="font-bold text-white font-mono text-xs">$${totalProfit.toFixed(2)} USDT</span>
          </div>
        </div>

        <!-- Downline Commission Perks -->
        <div class="flex justify-between items-center text-[10px] text-slate-400 py-1.5 px-1">
          <span>Direct ROI (L1): <strong class="text-cyan-300">10%/day</strong></span>
          <span>Team Comm: <strong class="text-amber-300">6% instant</strong></span>
        </div>

        <!-- Action Button -->
        <button onclick="promptPurchasePlan(${p.id})" class="w-full mt-2 py-2.5 rounded-xl font-bold text-white bg-gradient-to-r from-[#ff4e91] to-[#ff7675] hover:brightness-110 shadow-lg shadow-pink-500/20 transition text-xs flex items-center justify-center gap-1.5 cursor-pointer">
          <i data-lucide="zap" class="w-3.5 h-3.5 fill-white"></i> Activate $${p.price} Package
        </button>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

function promptPurchasePlan(planId) {
  if (!currentUser) {
    showToast('Please log in to activate an investment package', 'info');
    navigate('login');
    return;
  }

  const plan = allPlans.find(p => p.id === planId);
  if (!plan) return;

  document.getElementById('modal-plan-name').textContent = `Activate ${plan.name}`;
  document.getElementById('modal-plan-price').textContent = `$${plan.price} USDT`;
  document.getElementById('modal-plan-duration').textContent = `${plan.duration_days} Days`;
  document.getElementById('modal-plan-daily').textContent = `$${plan.daily_roi.toFixed(2)} USDT / day`;
  const totalAvail = (currentUser.wallet_balance || 0) + (currentUser.roi_balance || 0) + (currentUser.commission_balance || 0);
  document.getElementById('modal-user-bal').textContent = `$${totalAvail.toFixed(2)} USDT`;
  document.getElementById('modal-plan-id').value = plan.id;

  openModal('purchaseModal');
}

async function confirmPlanPurchase() {
  const planId = document.getElementById('modal-plan-id').value;
  const btn = document.querySelector('#purchaseModal button[onclick="confirmPlanPurchase()"]');
  const origText = btn ? btn.textContent : 'Confirm & Start Earning';

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Activating Package...';
  }

  try {
    const res = await fetch(`${API_BASE}/investments/purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ planId })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to purchase plan');
    }

    closeModal('purchaseModal');
    showToast(`🎉 Activated ${data.planName}! Daily ROI started.`, 'success');
    await fetchUserProfile();
    if (activeViewName === 'assets') await loadAssetsData();
    if (activeViewName === 'home') await loadAssetsData();
    if (activeViewName === 'history') await loadHistoryData();
    navigate('assets');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}

// ==================== VIEW 3: TEAM & MLM SUBORDINATE LOGIC (Matches uploaded images) ====================

// Initial/fallback team stats - defaults to 0 members until loaded from live network API
const defaultTeamStats = {
  totalTeam: 0,
  validUsers: 0,
  totalRecharge: 0.00,
  minTransactionAmount: 11.00,
  peopleToday: 0,
  validToday: 0,
  totalWithdrawals: 0.00,
  levels: {
    level1: { count: 0, effective: 0, volume: 0.00, commission: 0.00, users: [] },
    level2: { count: 0, effective: 0, volume: 0.00, commission: 0.00, users: [] },
    level3: { count: 0, effective: 0, volume: 0.00, commission: 0.00, users: [] }
  }
};

let teamStatsCache = defaultTeamStats;

async function loadTeamData() {
  const promoCode = currentUser ? (currentUser.referral_code || 'CATADMIN') : 'CATADMIN';
  const promoLink = `${getAppBaseUrl()}/?ref=${promoCode}`;

  const promoCodeEl = document.getElementById('team-promo-code');
  if (promoCodeEl) promoCodeEl.textContent = promoCode;

  const promoLinkEl = document.getElementById('team-promo-link');
  if (promoLinkEl) promoLinkEl.textContent = promoLink;

  const posterCodeEl = document.getElementById('poster-promo-code');
  if (posterCodeEl) posterCodeEl.textContent = promoCode;

  const posterQrEl = document.getElementById('poster-qr-img');
  if (posterQrEl) {
    posterQrEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(promoLink)}`;
  }

  // If user has token, fetch live from backend
  if (token) {
    try {
      const statsRes = await fetch(`${API_BASE}/network/downline-stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const statsData = await statsRes.json();
      if (statsData.success && statsData.levels) {
        teamStatsCache = statsData;
      }
    } catch (err) {
      console.warn('Live team stats unavailable, using cached/demo data:', err);
    }
  }

  updateTeamUIWithStats(teamStatsCache);
}

function updateTeamUIWithStats(s) {
  if (!s) return;

  // 1. Team size
  const sizeEl = document.getElementById('team-size-display');
  if (sizeEl) sizeEl.textContent = s.totalTeam || 0;

  // 2. Info rows inside card
  const validUsersEl = document.getElementById('team-valid-users');
  if (validUsersEl) validUsersEl.textContent = s.validUsers || 0;

  const totalRechargeEl = document.getElementById('team-total-recharge');
  if (totalRechargeEl) totalRechargeEl.textContent = (s.totalRecharge || 0).toFixed(2);

  const minTxnEl = document.getElementById('team-min-txn');
  if (minTxnEl) minTxnEl.textContent = (s.minTransactionAmount || 11.00).toFixed(2);

  // 3. 3-Stats grid
  const peopleTodayEl = document.getElementById('team-people-today');
  if (peopleTodayEl) peopleTodayEl.textContent = s.peopleToday || 0;

  const validTodayEl = document.getElementById('team-valid-today');
  if (validTodayEl) validTodayEl.textContent = s.validToday || 0;

  const totalWithdrawalsEl = document.getElementById('team-total-withdrawals');
  if (totalWithdrawalsEl) totalWithdrawalsEl.textContent = (s.totalWithdrawals || 0).toFixed(2);

  // 4. T1, T2, T3 stats
  const l1 = (s.levels && s.levels.level1) ? s.levels.level1 : { count: 0, effective: 0, commission: 0, users: [] };
  const l2 = (s.levels && s.levels.level2) ? s.levels.level2 : { count: 0, effective: 0, commission: 0, users: [] };
  const l3 = (s.levels && s.levels.level3) ? s.levels.level3 : { count: 0, effective: 0, commission: 0, users: [] };

  const t1CountEl = document.getElementById('t1-count');
  if (t1CountEl) t1CountEl.textContent = `${l1.count || 0}/${l1.effective || 0}`;
  const t1CommEl = document.getElementById('t1-commission');
  if (t1CommEl) t1CommEl.textContent = (l1.commission || 0).toFixed(2);

  const t2CountEl = document.getElementById('t2-count');
  if (t2CountEl) t2CountEl.textContent = `${l2.count || 0}/${l2.effective || 0}`;
  const t2CommEl = document.getElementById('t2-commission');
  if (t2CommEl) t2CommEl.textContent = (l2.commission || 0).toFixed(2);

  const t3CountEl = document.getElementById('t3-count');
  if (t3CountEl) t3CountEl.textContent = `${l3.count || 0}/${l3.effective || 0}`;
  const t3CommEl = document.getElementById('t3-commission');
  if (t3CommEl) t3CommEl.textContent = (l3.commission || 0).toFixed(2);

  // Render details accordions
  renderTierMembers(1, l1.users || []);
  renderTierMembers(2, l2.users || []);
  renderTierMembers(3, l3.users || []);
}

function safeFormatDate(dateStr) {
  if (!dateStr) return '2026-10-01';
  const m = String(dateStr).match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : String(dateStr).slice(0, 10);
}

function renderTierMembers(level, users) {
  const container = document.getElementById(`t${level}-details-container`);
  if (!container) return;

  if (!users || users.length === 0) {
    container.innerHTML = `<div class="text-center py-2.5 text-slate-500 text-[11px]">No T${level} subordinates in selected date range.</div>`;
    return;
  }

  container.innerHTML = users.map(u => `
    <div class="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between">
      <div>
        <div class="font-bold text-white text-xs">${u.full_name || u.username}</div>
        <div class="text-[10px] text-slate-400 font-mono">@${u.username} &bull; Joined ${safeFormatDate(u.created_at)}</div>
      </div>
      <div class="text-right">
        <div class="font-mono text-xs font-bold text-emerald-400">$${(u.active_investment || 0).toFixed(2)}</div>
        <div class="text-[9px] text-amber-400 font-semibold font-mono">+$${(u.commission_earned || 0).toFixed(2)} Comm</div>
      </div>
    </div>
  `).join('');
}

function toggleTierAccordion(level) {
  const container = document.getElementById(`t${level}-details-container`);
  const chevron = document.getElementById(`t${level}-chevron`);
  if (!container) return;

  const isHidden = container.classList.contains('hidden');
  if (isHidden) {
    container.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
  } else {
    container.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
  }
}

function copyPromoCode() {
  const code = currentUser ? (currentUser.referral_code || 'CATADMIN') : 'CATADMIN';
  copyToClipboard(code);
  showToast(`Promotion Code ${code} copied!`, 'success');
}

function copyPromoLink() {
  const code = currentUser ? (currentUser.referral_code || 'CATADMIN') : 'CATADMIN';
  const link = `${getAppBaseUrl()}/?ref=${code}`;
  copyToClipboard(link);
  showToast('Invitation link copied to clipboard!', 'success');
}

// ==================== INTERACTIVE DATE RANGE CALENDAR ====================

let calYear = 2026;
let calMonth = 9; // 0-based: 9 = October
let calStartDate = '2026-10-01';
let calEndDate = '2026-10-29';

function openTeamCalendarModal() {
  openModal('teamCalendarModal');
  renderInteractiveCalendar();
  if (window.lucide) lucide.createIcons();
}

function changeCalendarMonth(delta) {
  calMonth += delta;
  if (calMonth < 0) {
    calMonth = 11;
    calYear--;
  } else if (calMonth > 11) {
    calMonth = 0;
    calYear++;
  }
  renderInteractiveCalendar();
  if (window.lucide) lucide.createIcons();
}

function renderInteractiveCalendar() {
  const titleEl = document.getElementById('cal-month-title');
  const monthStr = String(calMonth + 1).padStart(2, '0');
  if (titleEl) titleEl.textContent = `${calYear}-${monthStr}`;

  const grid = document.getElementById('calendar-days-grid');
  if (!grid) return;

  const firstDayIndex = new Date(calYear, calMonth, 1).getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  let html = '';
  // Empty offset cells for preceding weekdays
  for (let i = 0; i < firstDayIndex; i++) {
    html += '<div class="cal-cell pointer-events-none"></div>';
  }

  const todayStr = '2026-10-05';

  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = `${calYear}-${monthStr}-${String(d).padStart(2, '0')}`;
    const isStart = (calStartDate === dayStr);
    const isEnd = (calEndDate === dayStr);
    const inRange = Boolean(calStartDate && calEndDate && dayStr > calStartDate && dayStr < calEndDate);
    const isSingle = Boolean(isStart && (!calEndDate || calStartDate === calEndDate));
    const isToday = (dayStr === todayStr);

    let cellClass = 'cal-cell';
    let innerContent = '';

    if (isSingle) {
      cellClass += ' single-selected';
      innerContent = `
        <div class="cal-pill">
          ${d}
        </div>
      `;
    } else if (isStart) {
      cellClass += ' range-start';
      innerContent = `
        <div class="cal-pill">
          ${d}
        </div>
      `;
    } else if (isEnd) {
      cellClass += ' range-end';
      innerContent = `
        <div class="cal-pill">
          ${d}
        </div>
      `;
    } else if (inRange) {
      cellClass += ' in-range';
      innerContent = `
        <span class="cal-cell-content text-white font-bold">
          ${d} ${isToday ? '<span class="cal-today-dot"></span>' : ''}
        </span>
      `;
    } else {
      innerContent = `
        <div class="cal-hover-circle">
          <span class="cal-cell-content text-slate-200">
            ${d} ${isToday ? '<span class="cal-today-dot"></span>' : ''}
          </span>
        </div>
      `;
    }

    html += `<div onclick="window.handleCalendarDateClick('${dayStr}')" class="${cellClass}" title="${dayStr}">${innerContent}</div>`;
  }

  grid.innerHTML = html;

  // Update modal footer text
  const startEl = document.getElementById('cal-selected-start');
  const endEl = document.getElementById('cal-selected-end');
  if (startEl) startEl.textContent = calStartDate || 'Start Date';
  if (endEl) {
    if (calEndDate) {
      endEl.textContent = calEndDate;
      endEl.classList.remove('text-slate-400');
      endEl.classList.add('text-slate-200');
    } else {
      endEl.textContent = 'End Date';
      endEl.classList.remove('text-slate-200');
      endEl.classList.add('text-slate-400');
    }
  }
}

function handleCalendarDateClick(dateStr) {
  if (!calStartDate || (calStartDate && calEndDate)) {
    // 1st click: Start a fresh selection
    calStartDate = dateStr;
    calEndDate = null;
  } else if (calStartDate && !calEndDate) {
    // 2nd click: Complete the range
    if (dateStr < calStartDate) {
      calEndDate = calStartDate;
      calStartDate = dateStr;
    } else {
      calEndDate = dateStr;
    }
  }
  renderInteractiveCalendar();
}

function confirmDateFilter() {
  if (!calStartDate) {
    calStartDate = '2026-10-01';
  }
  if (!calEndDate) {
    calEndDate = calStartDate;
  }

  const startDisplay = document.getElementById('team-date-start');
  const endDisplay = document.getElementById('team-date-end');

  if (startDisplay) startDisplay.textContent = `${calStartDate} 22:59:41`;
  if (endDisplay) endDisplay.textContent = `${calEndDate} 22:59:41`;

  applyTeamDateFilter(calStartDate, calEndDate);

  closeModal('teamCalendarModal');
  showToast(`Date filter applied: ${calStartDate} to ${calEndDate}`, 'success');
}

function resetTeamDateFilter() {
  calYear = 2026;
  calMonth = 9;
  calStartDate = '2026-10-01';
  calEndDate = '2026-10-29';

  const startDisplay = document.getElementById('team-date-start');
  const endDisplay = document.getElementById('team-date-end');

  if (startDisplay) startDisplay.textContent = '2026-10-01 22:59:41';
  if (endDisplay) endDisplay.textContent = '2026-10-29 22:59:41';

  renderInteractiveCalendar();
  applyTeamDateFilter(null, null);
  showToast('Date range reset to default', 'info');
}

function applyTeamDateFilter(startDate, endDate) {
  const s = teamStatsCache || defaultTeamStats;
  if (!startDate || !endDate) {
    updateTeamUIWithStats(s);
    return;
  }

  // Filter members by created_at range safely without invalid Date crashes on mobile
  const filterUsers = (users) => {
    if (!users || !Array.isArray(users)) return [];
    return users.filter(u => {
      if (!u.created_at) return true;
      const str = String(u.created_at);
      const match = str.match(/\d{4}-\d{2}-\d{2}/);
      const d = match ? match[0] : str.slice(0, 10);
      return d >= startDate && d <= endDate;
    });
  };

  const l1Users = filterUsers((s.levels && s.levels.level1) ? s.levels.level1.users : []);
  const l2Users = filterUsers((s.levels && s.levels.level2) ? s.levels.level2.users : []);
  const l3Users = filterUsers((s.levels && s.levels.level3) ? s.levels.level3.users : []);

  const calcMetrics = (users) => {
    let eff = 0;
    let vol = 0;
    let comm = 0;
    users.forEach(u => {
      if ((u.active_investment || 0) > 0) eff++;
      vol += (u.active_investment || 0);
      comm += (u.commission_earned || 0);
    });
    return { count: users.length, effective: eff, volume: vol, commission: comm, users };
  };

  const fl1 = calcMetrics(l1Users);
  const fl2 = calcMetrics(l2Users);
  const fl3 = calcMetrics(l3Users);

  const filteredStats = {
    totalTeam: fl1.count + fl2.count + fl3.count,
    validUsers: fl1.effective + fl2.effective + fl3.effective,
    totalRecharge: fl1.volume + fl2.volume + fl3.volume,
    minTransactionAmount: s.minTransactionAmount || 11.00,
    peopleToday: s.peopleToday || 0,
    validToday: s.validToday || 0,
    totalWithdrawals: s.totalWithdrawals || 0,
    levels: {
      level1: fl1,
      level2: fl2,
      level3: fl3
    }
  };

  updateTeamUIWithStats(filteredStats);
}

function openExclusivePosterModal() {
  openModal('exclusivePosterModal');
}

function sharePoster() {
  copyPromoLink();
  showToast('Poster link ready to share!', 'info');
}

function openUpgradeProgressModal(tier) {
  openModal('upgradeProgressModal');
}

window.copyPromoCode = copyPromoCode;
window.copyPromoLink = copyPromoLink;
window.openTeamCalendarModal = openTeamCalendarModal;
window.resetTeamDateFilter = resetTeamDateFilter;
window.confirmDateFilter = confirmDateFilter;
window.changeCalendarMonth = changeCalendarMonth;
window.handleCalendarDateClick = handleCalendarDateClick;
window.openExclusivePosterModal = openExclusivePosterModal;
window.sharePoster = sharePoster;
window.openUpgradeProgressModal = openUpgradeProgressModal;
window.toggleTierAccordion = toggleTierAccordion;
window.toggleAdminPortal = toggleAdminPortal;

function copyTeamReferral() {
  copyPromoLink();
}

function copyModalReferral() {
  const input = document.getElementById('modal-ref-input');
  if (input) {
    input.select();
    navigator.clipboard.writeText(input.value);
    showToast('Referral link copied to clipboard!', 'success');
  }
}

// ==================== VIEW 4: HISTORY PAGE (Requirement 1) ====================

let allHistoryTransactions = [];

async function loadHistoryData() {
  if (!token) return;

  try {
    const res = await fetch(`${API_BASE}/wallet/transactions?limit=100`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success && data.transactions) {
      allHistoryTransactions = data.transactions;
      filterHistory(currentHistoryFilter);
    }
  } catch (err) {
    console.error('Error loading history:', err);
  }
}

function filterHistory(type) {
  currentHistoryFilter = type;

  // Update filter buttons
  const buttons = document.querySelectorAll('.history-filter-btn');
  buttons.forEach(btn => {
    if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(`'${type}'`)) {
      btn.className = 'history-filter-btn active px-3 py-1 rounded-full bg-[#ff4e91] text-white font-bold whitespace-nowrap';
    } else {
      btn.className = 'history-filter-btn px-3 py-1 rounded-full bg-slate-800 text-slate-400 hover:text-white font-medium whitespace-nowrap';
    }
  });

  const container = document.getElementById('history-items-container');
  if (!container) return;

  let filtered = allHistoryTransactions;
  if (type !== 'all') {
    if (type === 'withdrawal') {
      filtered = allHistoryTransactions.filter(t => t.type === 'withdrawal' || t.type === 'refund');
    } else {
      filtered = allHistoryTransactions.filter(t => t.type === type);
    }
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 bg-[#11141c] rounded-2xl border border-slate-800/80">
        <i data-lucide="receipt" class="w-10 h-10 text-slate-600 mx-auto mb-2"></i>
        <p class="text-slate-300 font-semibold text-xs">No records found</p>
        <p class="text-[10px] text-slate-500 mt-0.5">Transactions in this category will appear here in real-time.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = filtered.map(tx => {
    const isDebit = tx.type === 'withdrawal' || tx.type === 'investment';
    const isRejected = (tx.status === 'rejected');
    const isPending = (tx.status === 'pending');
    const isCompleted = (tx.status === 'completed');

    let icon = 'trending-up';
    let color = 'text-emerald-400';
    let bg = 'bg-emerald-500/10';
    let label = 'Earnings';
    let mainTitle = 'Transaction';

    if (tx.type === 'daily_roi') {
      icon = 'trending-up';
      color = 'text-emerald-400';
      bg = 'bg-emerald-500/10';
      mainTitle = 'Daily ROI Income';
    } else if (tx.type === 'referral_roi') {
      icon = 'repeat';
      color = 'text-cyan-400';
      bg = 'bg-cyan-500/10';
      mainTitle = 'Referral Income';
    } else if (tx.type === 'team_commission') {
      icon = 'sparkles';
      color = 'text-amber-400';
      bg = 'bg-amber-500/10';
      mainTitle = 'Team Direct Commission';
    } else if (tx.type === 'deposit') {
      icon = 'arrow-down-left';
      color = 'text-pink-400';
      bg = 'bg-pink-500/10';
      mainTitle = 'Recharge Deposit';
    } else if (tx.type === 'withdrawal') {
      icon = isRejected ? 'x-circle' : 'arrow-up-right';
      color = isRejected ? 'text-rose-400' : 'text-rose-400';
      bg = isRejected ? 'bg-rose-500/20' : 'bg-rose-500/10';
      mainTitle = 'Withdrawal Request';
    } else if (tx.type === 'refund') {
      icon = 'rotate-ccw';
      color = 'text-cyan-400';
      bg = 'bg-cyan-500/10';
      mainTitle = 'Withdrawal Refund';
    } else if (tx.type === 'principal_return') {
      icon = 'shield-check';
      color = 'text-amber-400';
      bg = 'bg-amber-500/15';
      mainTitle = 'Principal Capital Refund';
    } else if (tx.type === 'investment') {
      icon = 'zap';
      color = 'text-cyan-400';
      bg = 'bg-cyan-500/10';
      mainTitle = 'Plan Activation';
    } else {
      mainTitle = tx.description || 'Transaction';
    }

    // Format Subtitle details cleanly
    let subtitleHtml = '';
    const desc = tx.description || '';

    if (tx.type === 'withdrawal') {
      const addrMatch = desc.match(/(0x[a-fA-F0-9]{40})/i);
      const rejMatch = desc.match(/\[Rejected:\s*([^\]]+)\]/i) || desc.match(/Rejected by Admin\s*\(([^)]+)\)/i);
      const appMatch = desc.match(/\[Approved:\s*([^\]]+)\]/i) || desc.match(/Approved:\s*([^\s)]+)/i);

      let parts = [];
      if (addrMatch) {
        const fullAddr = addrMatch[1];
        const shortAddr = fullAddr.substring(0, 6) + '...' + fullAddr.substring(38);
        parts.push(`<span class="font-mono text-slate-300">To: ${shortAddr}</span>`);
      }
      if (desc.includes('Fee: 0%')) {
        parts.push(`<span class="text-emerald-400 font-semibold">Fee: 0%</span>`);
      }
      if (parts.length > 0) {
        subtitleHtml += `<div class="text-[10.5px] text-slate-400 flex items-center gap-1.5 flex-wrap">${parts.join(' &bull; ')}</div>`;
      }

      if (rejMatch) {
        subtitleHtml += `<div class="text-[10px] text-rose-400 font-medium break-words leading-tight mt-0.5"><span class="font-bold">Reason:</span> ${rejMatch[1]}</div>`;
      } else if (appMatch) {
        subtitleHtml += `<div class="text-[10px] text-emerald-400 font-mono mt-0.5 truncate">TXID: ${appMatch[1]}</div>`;
      }
    } else if (tx.type === 'refund') {
      let reasonText = desc.replace(/^Withdrawal Refund:\s*/i, '').trim();
      if (reasonText) {
        subtitleHtml += `<div class="text-[10px] text-slate-400 break-words leading-tight mt-0.5">${reasonText}</div>`;
      }
    } else if (tx.type === 'deposit') {
      subtitleHtml += `<div class="text-[10.5px] text-slate-400 font-mono">Network: USDT-BEP20</div>`;
      if (tx.reference_id && /^0x[a-fA-F0-9]{64}$/i.test(tx.reference_id)) {
        subtitleHtml += `
          <div class="mt-0.5">
            <a href="https://bscscan.com/tx/${tx.reference_id}" target="_blank" rel="noopener noreferrer" class="text-cyan-400 hover:text-cyan-300 font-mono text-[9.5px] underline inline-flex items-center gap-1">
              <span>TX: ${tx.reference_id.substring(0, 8)}...${tx.reference_id.substring(58)}</span>
              <i data-lucide="external-link" class="w-2.5 h-2.5"></i>
            </a>
          </div>
        `;
      }
    } else if (tx.type === 'investment') {
      subtitleHtml += `<div class="text-[10.5px] text-slate-400 break-words leading-tight mt-0.5">${desc}</div>`;
    }

    let statusBadge = '';
    if (isRejected) {
      statusBadge = '<span class="text-[8.5px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/40 whitespace-nowrap">REJECTED</span>';
    } else if (isPending) {
      statusBadge = '<span class="text-[8.5px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 whitespace-nowrap">PENDING</span>';
    } else if (isCompleted) {
      statusBadge = '<span class="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 whitespace-nowrap">COMPLETED</span>';
    }

    const amountDisplay = isRejected
      ? `<span class="line-through text-slate-400 opacity-75">-${tx.amount.toFixed(2)} USDT</span>`
      : `<span class="${isDebit ? 'text-rose-400' : 'text-emerald-400'}">${isDebit ? '-' : '+'}${tx.amount.toFixed(2)} USDT</span>`;

    return `
      <div class="bg-[#11141c] border ${isRejected ? 'border-rose-900/50 bg-rose-950/10' : 'border-[#1e2433]'} rounded-2xl p-3 sm:p-3.5 flex items-start justify-between gap-2.5 text-xs hover:border-slate-700 transition shadow-sm overflow-hidden">
        <!-- Left Side: Icon + Title + Subtitle -->
        <div class="flex items-start gap-2.5 min-w-0 flex-1">
          <div class="w-8 h-8 rounded-xl ${bg} ${color} flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
            <i data-lucide="${icon}" class="w-4 h-4"></i>
          </div>
          <div class="min-w-0 flex-1 space-y-0.5 pr-1">
            <div class="font-bold text-white text-[12.5px] truncate">${mainTitle}</div>
            ${subtitleHtml}
            <div class="text-[10px] text-slate-500 font-mono pt-0.5">${new Date(tx.created_at).toLocaleString()}</div>
          </div>
        </div>

        <!-- Right Side: Amount + Badges (Never squished or overflowing!) -->
        <div class="text-right shrink-0 flex flex-col items-end gap-1.5 self-start pt-0.5">
          <div class="font-bold font-mono text-xs sm:text-[13px] whitespace-nowrap">
            ${amountDisplay}
          </div>
          <div class="flex items-center gap-1 flex-wrap justify-end">
            ${statusBadge}
            <span class="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/60 whitespace-nowrap">${(tx.wallet_type || 'wallet').split('_')[0]}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

// ==================== VIEW 5: ASSETS PAGE (Requirement 4: RS replaces with USDT) ====================

async function loadAssetsData() {
  if (!token) return;

  try {
    const res = await fetch(`${API_BASE}/wallet/overview`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success && data.wallets) {
      userWallets = data.wallets;
      const w = userWallets;

      // Requirement 4: RS replaced with USDT
      const totalAmountEl = document.getElementById('asset-total-amount');
      if (totalAmountEl) {
        totalAmountEl.textContent = `${(w.totalAssets || 0).toFixed(2)} USDT`;
      }

      const homeTotalEl = document.getElementById('home-total-balance');
      if (homeTotalEl) {
        homeTotalEl.textContent = (w.totalAssets || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      const withdrawableAmt = (w.totalWithdrawable !== undefined) 
        ? w.totalWithdrawable 
        : ((w.depositWallet || 0) + (w.roiWallet || 0) + (w.commissionWallet || 0));
      const stakedAmt = w.tradingAssets || 0;

      const homeWithdrawableEl = document.getElementById('home-withdrawable-balance');
      if (homeWithdrawableEl) {
        homeWithdrawableEl.textContent = withdrawableAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      const homeStakedEl = document.getElementById('home-staked-balance');
      if (homeStakedEl) {
        homeStakedEl.textContent = stakedAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      const assetWithdrawableEl = document.getElementById('asset-withdrawable-amount');
      if (assetWithdrawableEl) {
        assetWithdrawableEl.textContent = withdrawableAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      const assetStakedEl = document.getElementById('asset-staked-amount');
      if (assetStakedEl) {
        assetStakedEl.textContent = stakedAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      const totalRechargeEl = document.getElementById('asset-total-recharge');
      if (totalRechargeEl) {
        totalRechargeEl.textContent = `${(w.totalRecharge || 0).toFixed(2)} USDT`;
      }

      const totalWithdrawnEl = document.getElementById('asset-total-withdrawal');
      if (totalWithdrawnEl) {
        totalWithdrawnEl.textContent = `${(w.totalWithdrawn || 0).toFixed(2)} USDT`;
      }

      // Assets & Home Income Stats (Total Income, Referral Income, Team Commission)
      const totalEarnedVal = (w.totalEarned || (w.totalRoiIncome || 0) + (w.totalTeamRoiIncome || 0) + (w.totalTeamCommission || 0));
      const refIncomeVal = (w.totalTeamRoiIncome || 0);
      const teamCommVal = (w.totalTeamCommission || 0);

      // 1. Update 3 Home Income Cards directly above BTC/ETH/ETC
      const homeTotalIncomeEl = document.getElementById('home-stat-total-income');
      if (homeTotalIncomeEl) homeTotalIncomeEl.textContent = `$${totalEarnedVal.toFixed(2)}`;

      const homeRefIncomeEl = document.getElementById('home-stat-referral-income');
      if (homeRefIncomeEl) homeRefIncomeEl.textContent = `$${refIncomeVal.toFixed(2)}`;

      const homeTeamCommEl = document.getElementById('home-stat-team-comm');
      if (homeTeamCommEl) homeTeamCommEl.textContent = `$${teamCommVal.toFixed(2)}`;

      // 2. Assets View Stats
      const totalRoiEl = document.getElementById('stat-total-roi-income');
      if (totalRoiEl) {
        totalRoiEl.textContent = `${(w.totalRoiIncome || 0).toFixed(2)} USDT`;
      }

      const teamRoiEl = document.getElementById('stat-team-roi-income');
      if (teamRoiEl) {
        teamRoiEl.textContent = `${(w.totalTeamRoiIncome || 0).toFixed(2)} USDT`;
      }

      const teamCommEl = document.getElementById('stat-team-commission');
      if (teamCommEl) {
        teamCommEl.textContent = `${(w.totalTeamCommission || 0).toFixed(2)} USDT`;
      }

      // Legacy fallbacks if present
      const tradingAssetsEl = document.getElementById('stat-trading-assets');
      if (tradingAssetsEl) tradingAssetsEl.textContent = (w.tradingAssets || 0).toFixed(2);
      const bonusAssetsEl = document.getElementById('stat-bonus-assets');
      if (bonusAssetsEl) bonusAssetsEl.textContent = (w.bonusAssets || 0).toFixed(2);
      const accumulatedBonusEl = document.getElementById('stat-accumulated-bonus');
      if (accumulatedBonusEl) accumulatedBonusEl.textContent = (w.accumulatedBonus || 0).toFixed(2);
      const yesterdayIncomeEl = document.getElementById('stat-yesterday-income');
      if (yesterdayIncomeEl) yesterdayIncomeEl.textContent = `${(w.yesterdayIncome || 0).toFixed(2)} USDT`;
      const todayIncomeEl = document.getElementById('stat-today-income');
      if (todayIncomeEl) todayIncomeEl.textContent = `${(w.todayIncome || 0).toFixed(2)} USDT`;
      const profitMarginEl = document.getElementById('stat-profit-margin');
      if (profitMarginEl) profitMarginEl.textContent = w.profitMargin || '4.00%';
    }

    // Load active packages on home page
    await loadHomeActivePackages();

    // Apply Dynamic Announcement Ticker & Pop Image from Server Rules
    if (data.rules) {
      if (data.rules.announcementTicker) {
        const tickerEl = document.getElementById('home-ticker-text');
        if (tickerEl) tickerEl.textContent = data.rules.announcementTicker;
      }

      // Member Login Pop Image (Trigger once per session / on login)
      if (data.rules.popupImageActive && data.rules.popupImageUrl) {
        checkAndShowMemberLoginPopup(data.rules.popupImageUrl, data.rules.popupImageTitle);
      }

      // Dynamic Deposit Address & QR Code Update from server settings
      if (data.rules.depositAddress) {
        updateRechargeModalAddress(data.rules.depositAddress);
      }

      // Dynamic Minimum Withdrawal Threshold Update
      if (data.rules.minWithdrawal) {
        currentMinWithdrawal = parseFloat(data.rules.minWithdrawal) || 15;
        const minDisp = document.getElementById('withdraw-min-display');
        if (minDisp) minDisp.textContent = `${currentMinWithdrawal} USDT`;
        const amtInput = document.getElementById('withdraw-amount');
        if (amtInput) {
          amtInput.min = currentMinWithdrawal;
          amtInput.placeholder = `Min ${currentMinWithdrawal}`;
        }
      }
    }
  } catch (err) {
    console.error('Error loading assets data:', err);
  }
}

async function loadHomeActivePackages() {
  const container = document.getElementById('home-active-packages-container');
  if (!container || !token) return;

  try {
    const res = await fetch(`${API_BASE}/investments/my`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success && data.investments) {
      const activeInvestments = data.investments.filter(i => i.status === 'active');
      if (activeInvestments.length > 0) {
        container.innerHTML = activeInvestments.map(inv => {
          const planName = inv.plan_name || `VIP Plan`;
          const amount = (inv.amount || 0).toFixed(2);
          const dailyRoi = (inv.daily_roi || 0).toFixed(2);
          const totalEarned = (inv.total_earned || 0).toFixed(2);
          const maxRoi = (inv.max_roi || (inv.daily_roi * (inv.total_days || 0)) || 0).toFixed(2);
          const progressPercent = maxRoi > 0 ? Math.min(100, Math.round((totalEarned / maxRoi) * 100)) : 0;
          const createdDate = new Date(inv.created_at).toLocaleDateString();

          return `
            <div class="theme-card p-3.5 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-slate-900 to-slate-900 shadow-md">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2.5">
                  <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-black font-black text-xs shadow-sm shadow-amber-500/20">
                    VIP
                  </div>
                  <div>
                    <div class="font-extrabold text-xs text-white flex items-center gap-1.5">
                      <span>${planName}</span>
                      <span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Active</span>
                    </div>
                    <div class="text-[10px] text-slate-400 font-mono mt-0.5">Staked: $${amount} USDT &bull; Started: ${createdDate}</div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="font-black text-xs text-emerald-400 font-mono">+$${dailyRoi}/day</div>
                  <div class="text-[9.5px] text-amber-400 font-bold font-mono">Earned: $${totalEarned}</div>
                </div>
              </div>
              <div class="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                <span>Cycle Progress: ${progressPercent}%</span>
                <span>Max Return: $${maxRoi} USDT</span>
              </div>
              <div class="w-full bg-slate-800 rounded-full h-1.5 mt-1 overflow-hidden">
                <div class="bg-gradient-to-r from-amber-400 to-emerald-400 h-1.5 rounded-full" style="width: ${progressPercent}%"></div>
              </div>
              <div class="mt-2.5 flex items-center justify-between text-[10px] text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-xl border border-amber-500/20">
                <span class="flex items-center gap-1 font-semibold">
                  <i data-lucide="shield-check" class="w-3 h-3 text-amber-400"></i>
                  Principal Capital Return:
                </span>
                <span class="font-mono font-bold">$${amount} USDT on last closing day</span>
              </div>
            </div>
          `;
        }).join('');
      } else {
        container.innerHTML = `
          <div class="theme-card p-3 rounded-2xl flex items-center justify-between border border-slate-200 dark:border-slate-800/80 bg-slate-50/50 dark:bg-[#0c101a]/70">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 font-black text-xs">
                VIP
              </div>
              <div>
                <div class="font-bold text-xs text-slate-800 dark:text-white flex items-center gap-1.5">
                  <span>No Active Package</span>
                  <span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-500/20 text-slate-400">Idle</span>
                </div>
                <div class="text-[10px] text-slate-500 font-mono mt-0.5">Start investing to earn daily 4% ROI</div>
              </div>
            </div>
            <div class="text-right">
              <div class="font-black text-xs text-emerald-500 font-mono">$0.00 / day</div>
              <button onclick="openInvestPackages()" class="mt-1 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-extrabold text-[10px] shadow-sm transition active:scale-95 cursor-pointer">
                Stake
              </button>
            </div>
          </div>
        `;
      }
    }
  } catch (err) {
    console.warn('Failed to load active packages:', err);
  }
}
window.loadHomeActivePackages = loadHomeActivePackages;

let currentMinWithdrawal = 15;

function loadWithdrawalModalData() {
  updateWithdrawSourceAvailable();
  const minDisp = document.getElementById('withdraw-min-display');
  if (minDisp) minDisp.textContent = `${currentMinWithdrawal} USDT`;
  const amtInput = document.getElementById('withdraw-amount');
  if (amtInput) {
    amtInput.min = currentMinWithdrawal;
    amtInput.placeholder = `Min ${currentMinWithdrawal}`;
  }
}

function updateWithdrawSourceAvailable() {
  if (!userWallets) return;
  const availEl = document.getElementById('withdraw-available-bal');
  const source = document.getElementById('withdraw-source')?.value || 'all';
  let max = 0;

  if (source === 'roi_balance') max = userWallets.roiWallet || 0;
  else if (source === 'commission_balance') max = userWallets.commissionWallet || 0;
  else if (source === 'wallet_balance') max = userWallets.depositWallet || 0;
  else max = userWallets.totalWithdrawable || 0;

  if (availEl) {
    availEl.textContent = `${max.toFixed(2)} USDT`;
  }
}
window.updateWithdrawSourceAvailable = updateWithdrawSourceAvailable;

function setMaxWithdrawAmount() {
  if (!userWallets) return;
  const input = document.getElementById('withdraw-amount');
  const source = document.getElementById('withdraw-source')?.value || 'all';
  let max = 0;

  if (source === 'roi_balance') max = userWallets.roiWallet || 0;
  else if (source === 'commission_balance') max = userWallets.commissionWallet || 0;
  else if (source === 'wallet_balance') max = userWallets.depositWallet || 0;
  else max = userWallets.totalWithdrawable || 0;

  if (input) input.value = max;
}

function setRechargeAmount(amt) {
  const input = document.getElementById('deposit-amount');
  if (input) {
    input.value = amt;
    input.dispatchEvent(new Event('input'));
  }
}
window.setRechargeAmount = setRechargeAmount;

// ==================== DEPOSIT & WITHDRAWAL SUBMISSIONS ====================

async function handleDepositSubmit(e) {
  e.preventDefault();
  const amount = document.getElementById('deposit-amount').value;
  let txHash = (document.getElementById('deposit-txhash').value || '').trim();

  if (!amount || Number(amount) <= 0) {
    showToast('Please enter a valid deposit amount', 'error');
    return;
  }

  if (!txHash) {
    showToast('Transaction Hash / TXID is required for deposit verification', 'error');
    const hashInput = document.getElementById('deposit-txhash');
    if (hashInput) hashInput.focus();
    return;
  }

  // Auto-prepend 0x if user pasted 64 hex characters without prefix
  if (/^[a-fA-F0-9]{64}$/.test(txHash)) {
    txHash = '0x' + txHash;
    const hashInput = document.getElementById('deposit-txhash');
    if (hashInput) hashInput.value = txHash;
  }

  // Validate BSC BEP-20 Transaction Hash (66 chars, 0x + 64 hex chars)
  const txHashRegex = /^0x[a-fA-F0-9]{64}$/i;
  if (!txHashRegex.test(txHash)) {
    showToast('Please enter a valid 66-character BEP-20 Transaction Hash (starting with 0x)', 'error');
    const hashInput = document.getElementById('deposit-txhash');
    if (hashInput) hashInput.focus();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/wallet/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ amount: Number(amount), network: 'USDT-BEP20', txHash })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Deposit failed');
    }

    closeModal('rechargeModal');
    const depositInput = document.getElementById('deposit-amount');
    const hashInput = document.getElementById('deposit-txhash');
    if (depositInput) depositInput.value = '';
    if (hashInput) hashInput.value = '';

    showToast(`⏳ Deposit request of $${data.amount} USDT submitted! Funds will be credited upon Admin approval.`, 'info');
    await fetchUserProfile();
    if (activeViewName === 'assets') await loadAssetsData();
    if (activeViewName === 'history') await loadHistoryData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

let isWithdrawSubmitting = false;

async function handleWithdrawSubmit(e) {
  e.preventDefault();
  if (isWithdrawSubmitting) return;

  const submitBtn = e.target.querySelector('button[type="submit"]') || document.getElementById('btn-submit-withdraw');
  const amount = document.getElementById('withdraw-amount').value;
  const usdtAddress = (document.getElementById('withdraw-address').value || '').trim();
  const walletSource = document.getElementById('withdraw-source').value;

  const numAmount = Number(amount);
  if (!amount || isNaN(numAmount) || numAmount < currentMinWithdrawal) {
    showToast(`Minimum withdrawal amount is ${currentMinWithdrawal} USDT`, 'error');
    return;
  }

  // Client-side balance check to prevent over-withdrawing or negative balances
  if (currentUser) {
    let available = 0;
    const roiBal = Math.max(0, currentUser.roi_balance || 0);
    const commBal = Math.max(0, currentUser.commission_balance || 0);
    const walBal = Math.max(0, currentUser.wallet_balance || 0);

    if (walletSource === 'roi_balance') available = roiBal;
    else if (walletSource === 'commission_balance') available = commBal;
    else if (walletSource === 'wallet_balance') available = walBal;
    else available = roiBal + commBal + walBal;

    if (numAmount > available) {
      showToast(`Insufficient balance ($${available.toFixed(2)} USDT available in selected source)`, 'error');
      return;
    }
  }

  // Validate BEP-20 address (42 chars, 0x + 40 hex chars)
  const bep20AddressRegex = /^0x[a-fA-F0-9]{40}$/i;
  if (!bep20AddressRegex.test(usdtAddress)) {
    showToast('Please enter a valid 42-character USDT (BEP-20) address starting with 0x', 'error');
    const addrInput = document.getElementById('withdraw-address');
    if (addrInput) addrInput.focus();
    return;
  }

  isWithdrawSubmitting = true;
  const origBtnText = submitBtn ? submitBtn.innerHTML : 'Submit Withdrawal';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing Withdrawal...';
  }

  try {
    const res = await fetch(`${API_BASE}/wallet/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ amount: numAmount, usdtAddress, network: 'USDT-BEP20', walletSource })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Withdrawal failed');
    }

    closeModal('withdrawModal');
    showToast(`Withdrawal of $${data.amount} USDT submitted! 0% Fee applied.`, 'success');
    await fetchUserProfile();
    if (activeViewName === 'assets') await loadAssetsData();
    if (activeViewName === 'home') await loadAssetsData();
    if (activeViewName === 'history') await loadHistoryData();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    isWithdrawSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origBtnText;
    }
  }
}

// ==================== VIEW 6: ADMIN CONTROL & PORTAL IMPERSONATION ====================

let adminCachedUsers = [];
let currentInspectedUserId = null;
let originalAdminToken = localStorage.getItem('catalyst_admin_orig_token') || null;

let adminCurrentScope = {
  isSuperAdmin: false,
  teamAdmins: [],
  selectedTeamId: 'all'
};

function getAdminScopeQuery() {
  if (adminCurrentScope.isSuperAdmin && adminCurrentScope.selectedTeamId && adminCurrentScope.selectedTeamId !== 'all') {
    return `?teamAdminId=${encodeURIComponent(adminCurrentScope.selectedTeamId)}`;
  }
  return '';
}

function handleSuperAdminTeamChange() {
  const select = document.getElementById('superadmin-team-select');
  if (select) {
    adminCurrentScope.selectedTeamId = select.value;
  }
  loadAdminData();
}
window.handleSuperAdminTeamChange = handleSuperAdminTeamChange;

function filterSuperAdminToTeam(teamId) {
  const select = document.getElementById('superadmin-team-select');
  if (select) {
    select.value = String(teamId);
    adminCurrentScope.selectedTeamId = String(teamId);
    handleSuperAdminTeamChange();
    switchAdminTab('users');
  }
}
window.filterSuperAdminToTeam = filterSuperAdminToTeam;

function copyTeamAdminInviteLink(refCode) {
  const code = refCode || (currentUser?.referral_code || currentUser?.username);
  const url = `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
  copyToClipboard(url);
  showToast(`Team invite link copied: ${url}`, 'success');
}
window.copyTeamAdminInviteLink = copyTeamAdminInviteLink;

async function loadAdminData() {
  if (!token || !currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin')) return;

  try {
    // 0. Discover Admin Scope (Super Root Admin vs Team Admin)
    const meRes = await fetch(`${API_BASE}/admin/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const meData = await meRes.json();
    if (meData.success) {
      adminCurrentScope.isSuperAdmin = !!meData.isSuperAdmin;
      adminCurrentScope.teamAdmins = meData.teamAdmins || [];

      // Update Top Status Badges
      const roleBadge = document.getElementById('admin-portal-role-badge');
      const userTag = document.getElementById('admin-portal-user-tag');
      const scopeWrapper = document.getElementById('superadmin-scope-wrapper');
      const teamSelect = document.getElementById('superadmin-team-select');
      const teamTabBtn = document.getElementById('admin-tab-btn-teamadmins');
      const inviteBanner = document.getElementById('team-admin-invite-banner');

      if (adminCurrentScope.isSuperAdmin || currentUser.role === 'superadmin') {
        const srContainer = document.getElementById('super-root-master-container');
        const teamContainer = document.getElementById('team-admin-container');
        if (srContainer) srContainer.classList.remove('hidden');
        if (teamContainer) teamContainer.classList.add('hidden');

        await loadSuperRootMasterDashboard();
        return;
      } else {
        const srContainer = document.getElementById('super-root-master-container');
        const teamContainer = document.getElementById('team-admin-container');
        if (srContainer) srContainer.classList.add('hidden');
        if (teamContainer) teamContainer.classList.remove('hidden');

        if (roleBadge) {
          roleBadge.textContent = 'TEAM ADMIN';
          roleBadge.className = 'text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase tracking-wider flex items-center gap-1';
        }
        if (userTag) {
          const tName = meData.user.team_name || meData.user.username;
          userTag.textContent = `${tName} — Isolated Team Network`;
        }
        if (scopeWrapper) scopeWrapper.classList.add('hidden');
        if (teamTabBtn) teamTabBtn.classList.add('hidden');
        if (inviteBanner) {
          inviteBanner.classList.remove('hidden');
          const tNameEl = document.getElementById('team-admin-banner-name');
          if (tNameEl) tNameEl.textContent = meData.user.team_name || meData.user.username;
          const codeEl = document.getElementById('team-admin-banner-code');
          const myRef = meData.user.referral_code || meData.user.username;
          if (codeEl) codeEl.textContent = myRef;
          const linkInput = document.getElementById('team-admin-ref-link-input');
          if (linkInput) linkInput.value = `${window.location.origin}/?ref=${encodeURIComponent(myRef)}`;
        }
      }
    }

    const scopeQuery = getAdminScopeQuery();

    // 1. Load Platform Stats (Total Business, Deposits, Withdrawals, Users, ROI)
    const statsRes = await fetch(`${API_BASE}/admin/stats${scopeQuery}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const statsData = await statsRes.json();
    if (statsData.success && statsData.stats) {
      const s = statsData.stats;
      const bEl = document.getElementById('admin-stat-total-business');
      if (bEl) bEl.textContent = `$${(s.totalBusiness || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      const uEl = document.getElementById('admin-stat-total-users');
      if (uEl) uEl.textContent = s.totalUsers || 0;

      const dEl = document.getElementById('admin-stat-deposits');
      if (dEl) dEl.textContent = `$${(s.totalDepositsVolume || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const pDepEl = document.getElementById('admin-stat-pending-dep-sub');
      if (pDepEl) pDepEl.textContent = `${s.pendingDepositsCount || 0} Pending ($${(s.pendingDepositsVolume || 0).toFixed(2)})`;

      const wEl = document.getElementById('admin-stat-withdrawals');
      if (wEl) wEl.textContent = `$${(s.approvedWithdrawalsVolume || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const pWthEl = document.getElementById('admin-stat-pending-wth-sub');
      if (pWthEl) pWthEl.textContent = `${s.pendingWithdrawalsCount || 0} Pending ($${(s.pendingWithdrawalsVolume || 0).toFixed(2)})`;

      const bDep = document.getElementById('admin-badge-dep');
      if (bDep) {
        if (s.pendingDepositsCount > 0) {
          bDep.textContent = s.pendingDepositsCount;
          bDep.classList.remove('hidden');
        } else {
          bDep.classList.add('hidden');
        }
      }

      const bWth = document.getElementById('admin-badge-wth');
      if (bWth) {
        if (s.pendingWithdrawalsCount > 0) {
          bWth.textContent = s.pendingWithdrawalsCount;
          bWth.classList.remove('hidden');
        } else {
          bWth.classList.add('hidden');
        }
      }

      const bTkt = document.getElementById('admin-badge-tickets');
      if (bTkt) {
        if (s.openTicketsCount > 0) {
          bTkt.textContent = s.openTicketsCount;
          bTkt.classList.remove('hidden');
        } else {
          bTkt.classList.add('hidden');
        }
      }

      // Update ROI Execution schedule display
      const roiTime = s.roiClosingTime || '00:00';
      const roiTimeEl = document.getElementById('admin-roi-closing-time-text');
      const roiBadgeEl = document.getElementById('admin-roi-badge');
      const runRoiBtn = document.getElementById('admin-btn-run-roi');
      const runRoiText = document.getElementById('admin-btn-run-roi-text');

      if (s.alreadyExecutedToday) {
        if (roiTimeEl) roiTimeEl.textContent = `Completed for today (Executed at ${s.lastRoiExecution ? new Date(s.lastRoiExecution).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : roiTime})`;
        if (roiBadgeEl) {
          roiBadgeEl.textContent = 'Completed Today ✓';
          roiBadgeEl.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
        }
        if (runRoiBtn) {
          runRoiBtn.disabled = true;
          runRoiBtn.className = 'flex-1 sm:flex-initial px-4 py-2 rounded-xl font-extrabold bg-slate-800 text-slate-500 cursor-not-allowed transition text-xs flex items-center justify-center gap-1.5 whitespace-nowrap border border-slate-700/50';
          runRoiBtn.title = 'Daily ROI cycle has already executed for today. 1 execution per day enforced.';
          if (runRoiText) runRoiText.textContent = 'Done For Today (1/Day)';
        }
      } else {
        if (roiTimeEl) roiTimeEl.textContent = `${roiTime} Server Time`;
        if (roiBadgeEl) {
          roiBadgeEl.textContent = `Auto Scheduled @ ${roiTime}`;
          roiBadgeEl.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20';
        }
        if (runRoiBtn) {
          runRoiBtn.disabled = true;
          runRoiBtn.className = 'flex-1 sm:flex-initial px-4 py-2 rounded-xl font-extrabold bg-slate-800 text-slate-500 cursor-not-allowed transition text-xs flex items-center justify-center gap-1.5 whitespace-nowrap border border-slate-700/50';
          runRoiBtn.title = `ROI cycle executes automatically once daily at ${roiTime}.`;
          if (runRoiText) runRoiText.textContent = `Locked (${roiTime})`;
        }
      }

      // Also refresh admin notification badge
      await loadNotificationBadge();
    }

    // 2. Load Members List
    const usersRes = await fetch(`${API_BASE}/admin/users${scopeQuery}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const usersData = await usersRes.json();
    if (usersData.success && usersData.users) {
      adminCachedUsers = usersData.users;
      renderAdminUsersList(adminCachedUsers);
      populateManualDepositUserSelect(adminCachedUsers);
    }

    // 3. Load Withdrawals
    await loadAdminWithdrawals();

    // 4. Load Deposits
    await loadAdminDeposits();

    // 5. Load Tickets
    await loadAdminTickets();

    // 6. Load Announcements & Pop Image Settings
    await loadAdminSettings();

    // 7. Load Team Admins (if Super Root Admin)
    if (adminCurrentScope.isSuperAdmin) {
      await loadTeamAdminsList();
    }

  } catch (err) {
    console.error('Error loading admin data:', err);
  }
}

function switchAdminTab(tabName) {
  const tabs = ['users', 'withdrawals', 'deposits', 'tickets', 'announcements', 'settings', 'teamadmins'];
  tabs.forEach(t => {
    const btn = document.getElementById(`admin-tab-btn-${t}`);
    const content = document.getElementById(`admin-tab-content-${t}`);
    if (btn) {
      if (t === tabName) {
        btn.classList.add('active', 'bg-amber-500/20', 'text-amber-400', 'border', 'border-amber-500/30');
        btn.classList.remove('text-slate-400');
      } else {
        btn.classList.remove('active', 'bg-amber-500/20', 'text-amber-400', 'border', 'border-amber-500/30');
        btn.classList.add('text-slate-400');
      }
    }
    if (content) {
      if (t === tabName) content.classList.remove('hidden');
      else content.classList.add('hidden');
    }
  });
  if (tabName === 'settings') loadAdminPlatformSettings();
  if (tabName === 'teamadmins') loadTeamAdminsList();
  if (window.lucide) lucide.createIcons();
  const activeBtn = document.getElementById(`admin-tab-btn-${tabName}`);
  if (activeBtn) {
    activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
  setTimeout(() => updateTabSlideArrowStates('admin-tabs-container'), 300);
}
window.switchAdminTab = switchAdminTab;

function renderAdminUsersList(users) {
  const container = document.getElementById('admin-users-list');
  if (!container) return;

  if (!users || users.length === 0) {
    container.innerHTML = `<div class="text-center py-8 text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">No members found matching your search.</div>`;
    return;
  }

  container.innerHTML = users.map(u => `
    <div class="p-3.5 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition space-y-3 shadow-md overflow-hidden">
      <!-- Top Row: Avatar + User Info + Role/Status Badges -->
      <div class="flex items-start justify-between gap-2.5">
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-tr from-amber-500 to-amber-700 text-black font-black text-sm flex items-center justify-center shrink-0 shadow-sm">
            ${(u.full_name || u.username || 'U')[0].toUpperCase()}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="font-bold text-white text-xs sm:text-sm truncate max-w-[140px] sm:max-w-[200px]">${u.full_name || u.username}</span>
              <span class="text-slate-400 font-mono text-[11px]">(@${u.username})</span>
            </div>
            <div class="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5 flex-wrap font-mono">
              <span>Ref: <strong class="text-amber-400">${u.referral_code}</strong></span>
              <span class="text-slate-600">&bull;</span>
              <span>Sponsor: <span class="text-slate-300">${u.sponsor_username ? '@' + u.sponsor_username : 'None'}</span></span>
            </div>
          </div>
        </div>
        <div class="flex flex-col items-end gap-1 shrink-0">
          <span class="text-[9px] uppercase px-2 py-0.5 rounded font-mono font-bold ${u.role === 'admin' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-slate-800 text-cyan-400 border border-slate-700'}">${u.role}</span>
          <span class="text-[9px] uppercase px-1.5 py-0.5 rounded font-bold ${u.status === 'active' ? 'text-emerald-400' : 'text-rose-400'} flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full ${u.status === 'active' ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
            ${u.status}
          </span>
        </div>
      </div>

      <!-- Financial Metrics Grid -->
      <div class="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-[11px]">
        <div>
          <div class="text-[10px] text-slate-400 font-medium">Recharge Balance</div>
          <div class="font-bold font-mono text-cyan-300 text-xs sm:text-sm mt-0.5">$${(u.wallet_balance || 0).toFixed(2)}</div>
        </div>
        <div class="text-right">
          <div class="text-[10px] text-slate-400 font-medium">Active Investment</div>
          <div class="font-bold font-mono text-emerald-400 text-xs sm:text-sm mt-0.5">$${(u.active_invested || 0).toFixed(2)}</div>
        </div>
      </div>

      <!-- Actions Bar: Inspect Member Details & Manage -->
      <div class="pt-1 border-t border-slate-800/80">
        <button onclick="inspectAdminUser(${u.id})" class="w-full py-2 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition flex items-center justify-center gap-1.5 border border-slate-700 cursor-pointer active:scale-95" title="View Portfolio & Adjust">
          <i data-lucide="eye" class="w-3.5 h-3.5 text-amber-400"></i>
          <span>Inspect</span>
        </button>
      </div>
    </div>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

function filterAdminUsersList() {
  const query = (document.getElementById('admin-user-search-input')?.value || '').trim().toLowerCase();
  if (!query) {
    renderAdminUsersList(adminCachedUsers);
    return;
  }
  const filtered = adminCachedUsers.filter(u =>
    (u.username && u.username.toLowerCase().includes(query)) ||
    (u.full_name && u.full_name.toLowerCase().includes(query)) ||
    (u.email && u.email.toLowerCase().includes(query)) ||
    (u.referral_code && u.referral_code.toLowerCase().includes(query))
  );
  renderAdminUsersList(filtered);
}
window.filterAdminUsersList = filterAdminUsersList;

async function inspectAdminUser(userId) {
  try {
    currentInspectedUserId = userId;
    const res = await fetch(`${API_BASE}/admin/users/${userId}/details`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.success || !data.user) throw new Error(data.error || 'Failed to fetch user details');

    const u = data.user;
    document.getElementById('aud-fullname').textContent = u.full_name || u.username;
    document.getElementById('aud-username').textContent = `@${u.username}`;
    document.getElementById('aud-avatar').textContent = (u.full_name || u.username || 'U')[0].toUpperCase();
    document.getElementById('aud-role-badge').textContent = u.role.toUpperCase();

    document.getElementById('aud-wallet-bal').textContent = `$${(u.wallet_balance || 0).toFixed(2)}`;
    document.getElementById('aud-roi-bal').textContent = `$${(u.roi_balance || 0).toFixed(2)}`;
    document.getElementById('aud-comm-bal').textContent = `$${(u.commission_balance || 0).toFixed(2)}`;

    document.getElementById('aud-email').textContent = u.email || '-';
    document.getElementById('aud-phone').textContent = u.phone || '-';
    document.getElementById('aud-refcode').textContent = u.referral_code;
    document.getElementById('aud-sponsor').textContent = u.sponsor_username ? `@${u.sponsor_username}` : 'Direct Master';
    const audUsdtInput = document.getElementById('aud-usdt-input');
    if (audUsdtInput) audUsdtInput.value = u.usdt_address || '';

    const stEl = document.getElementById('aud-status');
    if (stEl) {
      stEl.textContent = u.status.toUpperCase();
      stEl.className = `font-bold uppercase text-[11px] ${u.status === 'active' ? 'text-emerald-400' : 'text-rose-400'}`;
    }

    // Render investments
    const invContainer = document.getElementById('aud-investments-list');
    if (invContainer) {
      if (data.investments && data.investments.length > 0) {
        invContainer.innerHTML = data.investments.map(i => `
          <div class="p-2 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-between text-xs">
            <div>
              <div class="font-bold text-white">${i.plan_name} ($${i.amount})</div>
              <div class="text-[10px] text-slate-400">Earned: $${(i.total_earned || 0).toFixed(2)} &bull; ${i.days_credited}/${i.total_days} days</div>
            </div>
            <span class="text-[9px] uppercase px-1.5 py-0.5 rounded font-bold ${i.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-300'}">${i.status}</span>
          </div>
        `).join('');
      } else {
        invContainer.innerHTML = `<div class="text-center py-2 text-slate-500">No investment plans active</div>`;
      }
    }



    openModal('adminUserDetailModal');
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.inspectAdminUser = inspectAdminUser;

async function adminImpersonateUser(userId) {
  try {
    const res = await fetch(`${API_BASE}/admin/impersonate/${userId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (!data.success || !data.token) throw new Error(data.error || 'Impersonation failed');

    // Save admin original token so admin can return
    if (!originalAdminToken) {
      originalAdminToken = token;
      localStorage.setItem('catalyst_admin_orig_token', originalAdminToken);
    }

    // Switch active credentials to target user
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('catalyst_token', token);

    closeModal('adminUserDetailModal');

    // Show Impersonation banner
    const banner = document.getElementById('impersonation-alert-banner');
    const uEl = document.getElementById('impersonation-active-user');
    if (banner && uEl) {
      uEl.textContent = `@${currentUser.username} (${currentUser.full_name || ''})`;
      banner.classList.remove('hidden');
    }

    updateAuthUI();
    showToast(`Switched into member portal of @${currentUser.username}!`, 'info');
    navigate('home');
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.adminImpersonateUser = adminImpersonateUser;

function exitImpersonation() {
  if (!originalAdminToken) return;
  token = originalAdminToken;
  localStorage.setItem('catalyst_token', token);
  localStorage.removeItem('catalyst_admin_orig_token');
  originalAdminToken = null;

  const banner = document.getElementById('impersonation-alert-banner');
  if (banner) banner.classList.add('hidden');

  fetchUserProfile().then(() => {
    showToast('Returned to Master Admin Portal!', 'success');
    navigate('admin');
  });
}
window.exitImpersonation = exitImpersonation;

async function handleAdminAdjustBalance(e) {
  e.preventDefault();
  if (!currentInspectedUserId) return;
  const walletType = document.getElementById('adj-wallet-type').value;
  const action = document.getElementById('adj-action').value;
  const amount = document.getElementById('adj-amount').value;

  try {
    const res = await fetch(`${API_BASE}/admin/adjust-balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        userId: currentInspectedUserId,
        amount,
        walletType,
        action,
        reason: 'Admin Panel Quick Adjustment'
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Adjustment failed');

    showToast(data.message || 'Balance updated!', 'success');
    document.getElementById('adj-amount').value = '';
    await inspectAdminUser(currentInspectedUserId);
    await loadAdminData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleAdminAdjustBalance = handleAdminAdjustBalance;

// ==================== ADMIN DEPOSITS & WITHDRAWALS ====================

async function loadAdminWithdrawals() {
  const scopeQuery = getAdminScopeQuery();
  const withRes = await fetch(`${API_BASE}/admin/withdrawals${scopeQuery}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const withData = await withRes.json();
  const withContainer = document.getElementById('admin-withdrawals-list');
  if (!withContainer) return;

  if (withData.success && withData.withdrawals && withData.withdrawals.length > 0) {
    withContainer.innerHTML = withData.withdrawals.map(w => `
      <div class="p-3.5 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5 hover:border-slate-700 transition shadow-md overflow-hidden">
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="font-bold text-white text-xs flex items-center gap-1.5 flex-wrap">
              <span>#${w.id}</span>
              <span class="text-slate-600">&bull;</span>
              <span>${w.full_name || w.username}</span>
              <span class="text-slate-400 font-mono text-[11px]">(@${w.username})</span>
            </div>
            <div class="text-[10px] text-slate-400 font-mono mt-0.5">
              ${new Date(w.created_at).toLocaleString()}
            </div>
          </div>
          <div class="text-right shrink-0">
            <div class="font-bold text-rose-400 font-mono text-sm sm:text-base">$${parseFloat(w.amount).toFixed(2)} USDT</div>
            <span class="text-[9px] uppercase px-2 py-0.5 rounded font-bold font-mono inline-block mt-0.5 ${w.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : (w.status === 'rejected' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30')}">${w.status}</span>
          </div>
        </div>

        <div class="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-[11px] font-mono">
          <div class="text-[10px] text-slate-400 flex items-center justify-between mb-1">
            <span>Destination Address (BEP-20):</span>
            <span class="text-cyan-400 text-[10px] font-bold">${w.network || 'USDT-BEP20'}</span>
          </div>
          ${w.usdt_address && /^0x[a-fA-F0-9]{40}$/i.test(w.usdt_address) ? `
            <div class="space-y-1.5">
              <div class="text-slate-200 font-bold break-all select-all text-[11px]">${w.usdt_address}</div>
              <div class="flex items-center gap-2 flex-wrap pt-0.5">
                <a href="https://bscscan.com/address/${w.usdt_address}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 text-[10px] font-bold inline-flex items-center gap-1 transition shadow-sm">
                  <i data-lucide="external-link" class="w-3 h-3"></i> View Address on BscScan
                </a>
                <button type="button" onclick="copyToClipboard('${w.usdt_address}')" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-sans font-bold transition">Copy</button>
              </div>
            </div>
          ` : `
            <div class="text-slate-200 font-bold break-all select-all text-[11px]">${w.usdt_address || 'No address provided'}</div>
          `}
          ${w.tx_hash ? `
            <div class="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between flex-wrap gap-1 text-[10px]">
              <span class="text-slate-400">Payout TXID:</span>
              <a href="https://bscscan.com/tx/${w.tx_hash}" target="_blank" rel="noopener noreferrer" class="text-emerald-400 hover:text-emerald-300 underline font-mono inline-flex items-center gap-1 break-all">
                <span>${w.tx_hash.length > 20 ? w.tx_hash.substring(0, 10) + '...' + w.tx_hash.substring(w.tx_hash.length - 8) : w.tx_hash}</span> <i data-lucide="external-link" class="w-2.5 h-2.5"></i>
              </a>
            </div>
          ` : ''}
        </div>

        ${w.status === 'pending' ? `
          <div class="flex items-center gap-2 pt-1 border-t border-slate-800/80">
            <button onclick="approveWithdrawal(${w.id}, this)" class="flex-1 py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shadow-emerald-500/20 active:scale-95">
              <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i>
              <span>Approve Payout</span>
            </button>
            <button onclick="rejectWithdrawal(${w.id})" class="flex-1 py-2 px-3 rounded-xl bg-rose-500/20 border border-rose-500/40 hover:bg-rose-500/30 text-rose-400 font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95">
              <i data-lucide="x-circle" class="w-3.5 h-3.5"></i>
              <span>Reject</span>
            </button>
          </div>
        ` : ''}
      </div>
    `).join('');
    if (window.lucide) lucide.createIcons();
  } else {
    withContainer.innerHTML = `<div class="text-center py-8 text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">No withdrawal requests found</div>`;
  }
}

async function approveWithdrawal(id, btnElement) {
  const btn = btnElement || (typeof event !== 'undefined' ? (event?.currentTarget || event?.target) : null);
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="inline-block animate-spin mr-1">⏳</span><span>Approving...</span>`;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/withdrawals/${id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Withdrawal #${id} approved successfully!`, 'success');
      loadAdminData();
    } else {
      showToast(data.error || 'Approval failed', 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml || '<span>Approve Payout</span>';
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml || '<span>Approve Payout</span>';
    }
  }
}
window.approveWithdrawal = approveWithdrawal;

async function rejectWithdrawal(id) {
  const reason = prompt('Enter rejection reason for member:', 'Incorrect wallet address or suspicious activity');
  if (!reason) return;

  try {
    const res = await fetch(`${API_BASE}/admin/withdrawals/${id}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ reason })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Withdrawal #${id} rejected and funds refunded to user!`, 'info');
      loadAdminData();
    } else {
      showToast(data.error || 'Rejection failed', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.rejectWithdrawal = rejectWithdrawal;

async function loadAdminDeposits() {
  const scopeQuery = getAdminScopeQuery();
  const depRes = await fetch(`${API_BASE}/admin/deposits${scopeQuery}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const depData = await depRes.json();
  const depContainer = document.getElementById('admin-deposits-list');
  if (!depContainer) return;

  if (depData.success && depData.deposits && depData.deposits.length > 0) {
    depContainer.innerHTML = depData.deposits.map(d => `
      <div class="p-3.5 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5 hover:border-slate-700 transition shadow-md overflow-hidden">
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="font-bold text-white text-xs flex items-center gap-1.5 flex-wrap">
              <span>#${d.id}</span>
              <span class="text-slate-600">&bull;</span>
              <span>${d.full_name || d.username}</span>
              <span class="text-slate-400 font-mono text-[11px]">(@${d.username})</span>
            </div>
            <div class="text-[10px] text-slate-400 font-mono mt-0.5">
              ${new Date(d.created_at).toLocaleString()}
            </div>
          </div>
          <div class="text-right shrink-0">
            <div class="font-bold text-emerald-400 font-mono text-sm sm:text-base">+$${parseFloat(d.amount).toFixed(2)} USDT</div>
            <span class="text-[9px] uppercase px-2 py-0.5 rounded font-bold font-mono inline-block mt-0.5 ${d.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : (d.status === 'rejected' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30')}">${d.status}</span>
          </div>
        </div>

        <div class="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-[11px] font-mono">
          <div class="text-[10px] text-slate-400 flex items-center justify-between mb-1.5">
            <span>Tx Hash / Verification:</span>
            <span class="text-cyan-400 text-[10px] font-bold">${d.network || 'USDT-BEP20'}</span>
          </div>
          ${d.tx_hash && /^0x[a-fA-F0-9]{64}$/i.test(d.tx_hash) ? `
            <div class="space-y-1.5">
              <div class="text-slate-300 font-bold break-all select-all text-[11px]">${d.tx_hash}</div>
              <div class="flex items-center gap-2 flex-wrap pt-0.5">
                <a href="https://bscscan.com/tx/${d.tx_hash}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 text-[10px] font-bold inline-flex items-center gap-1 transition shadow-sm">
                  <i data-lucide="external-link" class="w-3 h-3"></i> Verify on BscScan
                </a>
                <button type="button" onclick="copyToClipboard('${d.tx_hash}')" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-sans font-bold transition">Copy TXID</button>
              </div>
            </div>
          ` : `
            <div class="text-slate-200 font-bold break-all select-all text-[11px]">${d.tx_hash || 'Internal Admin Credit'}</div>
          `}
        </div>

        ${d.status === 'pending' ? `
          <div class="flex items-center gap-2 pt-1 border-t border-slate-800/80">
            <button onclick="approveDeposit(${d.id})" class="flex-1 py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shadow-emerald-500/20 active:scale-95">
              <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i>
              <span>Approve & Credit</span>
            </button>
            <button onclick="rejectDeposit(${d.id})" class="flex-1 py-2 px-3 rounded-xl bg-rose-500/20 border border-rose-500/40 hover:bg-rose-500/30 text-rose-400 font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95">
              <i data-lucide="x-circle" class="w-3.5 h-3.5"></i>
              <span>Reject</span>
            </button>
          </div>
        ` : ''}
      </div>
    `).join('');
    if (window.lucide) lucide.createIcons();
  } else {
    depContainer.innerHTML = `<div class="text-center py-8 text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">No deposit records found</div>`;
  }
}

async function approveDeposit(id) {
  try {
    const res = await fetch(`${API_BASE}/admin/deposits/${id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Deposit approved and credited!', 'success');
      loadAdminData();
    } else {
      showToast(data.error || 'Approval failed', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.approveDeposit = approveDeposit;

async function rejectDeposit(id) {
  const reason = prompt('Enter rejection reason:');
  if (!reason) return;
  try {
    const res = await fetch(`${API_BASE}/admin/deposits/${id}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ reason })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Deposit rejected', 'info');
      loadAdminData();
    } else {
      showToast(data.error || 'Rejection failed', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.rejectDeposit = rejectDeposit;

function populateManualDepositUserSelect(users) {
  const select = document.getElementById('amd-user-select');
  if (!select) return;
  select.innerHTML = '<option value="">Select a user...</option>' + users.map(u => `
    <option value="${u.id}">${u.full_name || u.username} (@${u.username} - Ref: ${u.referral_code})</option>
  `).join('');
}

function openManualDepositModal() {
  populateManualDepositUserSelect(adminCachedUsers);
  openModal('adminManualDepositModal');
}
window.openManualDepositModal = openManualDepositModal;

function openManualDepositForUser(userId) {
  openManualDepositModal();
  const select = document.getElementById('amd-user-select');
  if (select) select.value = userId;
}
window.openManualDepositForUser = openManualDepositForUser;

async function handleAdminManualDepositSubmit(e) {
  e.preventDefault();
  const userId = document.getElementById('amd-user-select').value;
  const amount = document.getElementById('amd-amount').value;
  const network = document.getElementById('amd-network').value;
  const txHash = document.getElementById('amd-txhash').value.trim();

  try {
    const res = await fetch(`${API_BASE}/admin/deposits/manual-create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ userId, amount, network, txHash })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Manual deposit failed');

    closeModal('adminManualDepositModal');
    showToast(data.message || 'Manual deposit credited successfully!', 'success');
    await loadAdminData();
    if (currentInspectedUserId) await inspectAdminUser(currentInspectedUserId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleAdminManualDepositSubmit = handleAdminManualDepositSubmit;

// ==================== SUPPORT TICKETS LOGIC (ADMIN & USER) ====================

async function loadAdminTickets() {
  const res = await fetch(`${API_BASE}/admin/tickets`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  const container = document.getElementById('admin-tickets-list');
  if (!container) return;

  if (data.success && data.tickets && data.tickets.length > 0) {
    container.innerHTML = data.tickets.map(t => `
      <div class="p-3.5 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5 hover:border-slate-700 transition shadow-md overflow-hidden">
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="font-bold text-white text-xs flex items-center gap-2 flex-wrap">
              <span>#${t.id} &bull; ${t.subject}</span>
              <span class="text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-mono border border-cyan-500/30">${t.category}</span>
            </div>
            <div class="text-[10px] text-slate-400 font-mono mt-0.5">
              By <strong class="text-slate-200">@${t.username}</strong> &bull; ${new Date(t.created_at).toLocaleString()}
            </div>
          </div>
          <span class="text-[9px] uppercase font-bold px-2 py-0.5 rounded shrink-0 ${t.status === 'open' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}">${t.status}</span>
        </div>

        <div class="text-xs text-slate-300 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 whitespace-pre-line break-words">
          ${t.message}
        </div>

        ${t.admin_reply ? `
          <div class="text-xs text-emerald-300 bg-emerald-950/20 p-2.5 rounded-xl border border-emerald-900/40 break-words">
            <strong class="text-emerald-400">Admin Reply:</strong> ${t.admin_reply}
          </div>
        ` : ''}

        <div class="flex items-center justify-end pt-1 border-t border-slate-800/80">
          <button onclick="openAdminTicketReplyModal(${t.id}, '${escapeQuote(t.username)}', '${escapeQuote(t.category)}', '${escapeQuote(t.subject)}', '${escapeQuote(t.message)}')" class="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs transition flex items-center gap-1.5 cursor-pointer shadow-sm shadow-amber-500/20 active:scale-95">
            <i data-lucide="message-square" class="w-3.5 h-3.5"></i>
            <span>Reply to Member</span>
          </button>
        </div>
      </div>
    `).join('');
    if (window.lucide) lucide.createIcons();
  } else {
    container.innerHTML = `<div class="text-center py-8 text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">No support tickets found</div>`;
  }
}

function escapeQuote(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function openAdminTicketReplyModal(id, username, category, subject, message) {
  document.getElementById('at-reply-ticket-id').value = id;
  document.getElementById('at-reply-ticket-user').textContent = `@${username}`;
  document.getElementById('at-reply-ticket-category').textContent = category;
  document.getElementById('at-reply-ticket-subject').textContent = subject;
  document.getElementById('at-reply-ticket-msg').textContent = message;
  document.getElementById('at-reply-text').value = '';
  openModal('adminTicketReplyModal');
}
window.openAdminTicketReplyModal = openAdminTicketReplyModal;

async function handleAdminTicketReplySubmit(e) {
  e.preventDefault();
  const id = document.getElementById('at-reply-ticket-id').value;
  const reply = document.getElementById('at-reply-text').value.trim();
  const status = document.getElementById('at-reply-status').value;

  try {
    const res = await fetch(`${API_BASE}/admin/tickets/${id}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ reply, status })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to submit reply');

    closeModal('adminTicketReplyModal');
    showToast('Reply sent successfully!', 'success');
    loadAdminTickets();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleAdminTicketReplySubmit = handleAdminTicketReplySubmit;

function openSupportTicketModal() {
  closeProfileDropdown();
  loadMemberSupportTickets();
  openModal('memberSupportModal');
}
window.openSupportTicketModal = openSupportTicketModal;

async function loadMemberSupportTickets() {
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/auth/tickets`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    const container = document.getElementById('member-tickets-list');
    if (!container) return;

    if (data.success && data.tickets && data.tickets.length > 0) {
      container.innerHTML = data.tickets.map(t => `
        <div class="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="font-bold text-white text-xs">${t.subject}</span>
            <span class="text-[9px] uppercase font-bold px-1.5 py-0.2 rounded ${t.status === 'open' ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}">${t.status}</span>
          </div>
          <p class="text-[11px] text-slate-300">${t.message}</p>
          ${t.admin_reply ? `
            <div class="p-2 rounded-lg bg-cyan-950/30 border border-cyan-800/40 text-[11px] text-cyan-300 mt-1">
              <strong>Admin Response:</strong> ${t.admin_reply}
            </div>
          ` : `<div class="text-[10px] text-slate-500 italic">Waiting for admin response...</div>`}
        </div>
      `).join('');
    } else {
      container.innerHTML = `<div class="text-center py-4 text-slate-500">No support tickets created yet</div>`;
    }
  } catch (err) {
    console.error('Failed to load tickets:', err);
  }
}

async function handleCreateSupportTicket(e) {
  e.preventDefault();
  const category = document.getElementById('st-category').value;
  const subject = document.getElementById('st-subject').value.trim();
  const message = document.getElementById('st-message').value.trim();

  try {
    const res = await fetch(`${API_BASE}/auth/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ category, subject, message })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to submit ticket');

    showToast('Support ticket submitted successfully!', 'success');
    document.getElementById('st-subject').value = '';
    document.getElementById('st-message').value = '';
    loadMemberSupportTickets();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleCreateSupportTicket = handleCreateSupportTicket;

// ==================== UTILS & HELPERS ====================

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    lucide.createIcons();
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('flex');
    modal.classList.add('hidden');
  }
}

function copyToClipboard(text) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied to clipboard!', 'info');
    }).catch(() => {
      fallbackCopyText(text);
      showToast('Copied to clipboard!', 'info');
    });
  } else {
    fallbackCopyText(text);
    showToast('Copied to clipboard!', 'info');
  }
}

function fallbackCopyText(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch (e) {
    console.warn('Fallback copy error:', e);
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const colors = {
    success: 'bg-[#10141f] border-emerald-500 text-emerald-300',
    error: 'bg-[#10141f] border-rose-500 text-rose-300',
    info: 'bg-[#10141f] border-[#ff4e91] text-pink-200'
  };

  toast.className = `toast border rounded-xl p-3 shadow-2xl backdrop-blur-md text-xs font-semibold flex items-center justify-between gap-3 pointer-events-auto ${colors[type] || colors.info}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()" class="text-slate-400 hover:text-white">&times;</button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentElement) toast.remove();
  }, 4000);
}

// ==================== FORGOT PASSWORD (EMAIL OTP) ====================

function openForgotPasswordModal() {
  const emailInput = document.getElementById('fp-email-input');
  const otpInput = document.getElementById('fp-otp-input');
  const newPass = document.getElementById('fp-new-password');
  const confPass = document.getElementById('fp-confirm-password');
  const loginIdInput = document.getElementById('login-id');

  if (emailInput) {
    emailInput.value = (loginIdInput && loginIdInput.value.includes('@')) ? loginIdInput.value.trim() : '';
  }
  if (otpInput) otpInput.value = '';
  if (newPass) newPass.value = '';
  if (confPass) confPass.value = '';

  const btn = document.getElementById('btn-fp-send-otp');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Send OTP';
  }

  openModal('forgotPasswordModal');
}
window.openForgotPasswordModal = openForgotPasswordModal;

async function handleSendForgotPasswordOtp() {
  const emailInput = document.getElementById('fp-email-input');
  const email = emailInput ? emailInput.value.trim() : '';
  const btn = document.getElementById('btn-fp-send-otp');

  if (!email || !email.includes('@')) {
    showToast('Please enter your registered email address', 'error');
    return;
  }

  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, purpose: 'forgot_password' })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Password reset OTP sent to your email! Please check inbox/spam.', 'success');
      if (btn) btn.textContent = 'OTP Sent';
    } else {
      showToast(data.error || 'Failed to send reset OTP', 'error');
      if (btn) btn.disabled = false;
    }
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) btn.disabled = false;
  }
}
window.handleSendForgotPasswordOtp = handleSendForgotPasswordOtp;

async function handleResetPasswordSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('fp-email-input')?.value.trim();
  const otp = document.getElementById('fp-otp-input')?.value.trim();
  const newPassword = document.getElementById('fp-new-password')?.value;
  const confirmPassword = document.getElementById('fp-confirm-password')?.value;

  if (!email || !otp) {
    showToast('Email and OTP code are required', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    showToast('Passwords do not match!', 'error');
    return;
  }
  if (newPassword.length < 6) {
    showToast('Password must be at least 6 characters', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp, newPassword })
    });
    const data = await res.json();
    if (data.success) {
      closeModal('forgotPasswordModal');
      showToast('Password reset successfully! You can now login.', 'success');
      const loginPassInput = document.getElementById('login-password');
      if (loginPassInput) loginPassInput.value = '';
    } else {
      showToast(data.error || 'Failed to reset password', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleResetPasswordSubmit = handleResetPasswordSubmit;

// ==================== NOTICE TICKER & POPUP IMAGE MANAGER ====================

let currentPopupImageBase64 = '';

async function loadAdminSettings() {
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/admin/settings`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success && data.settings) {
      const settingsMap = data.settings.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {});

      // Ticker text
      const tickerInput = document.getElementById('admin-ticker-input');
      if (tickerInput) {
        tickerInput.value = settingsMap.announcement_ticker || 'Welcome to the official Catalyst Capital trading platform • High Frequency AI Trading • Instant 0% Withdrawal Payouts • Daily ROI Active •';
      }

      // Pop image
      const chkActive = document.getElementById('admin-popup-active-checkbox');
      if (chkActive) {
        chkActive.checked = (settingsMap.popup_image_active === '1' || settingsMap.popup_image_active === 'true');
      }

      const titleInput = document.getElementById('admin-popup-title-input');
      if (titleInput) {
        titleInput.value = settingsMap.popup_image_title || 'Special Platform Announcement';
      }

      const urlInput = document.getElementById('admin-popup-url-input');
      const imgUrl = settingsMap.popup_image_url || '';
      if (urlInput) urlInput.value = imgUrl.startsWith('data:') ? '' : imgUrl;

      const box = document.getElementById('admin-popup-preview-box');
      const previewImg = document.getElementById('admin-popup-preview-img');
      if (imgUrl) {
        currentPopupImageBase64 = imgUrl;
        showAdminPopupPreview(imgUrl);
      } else {
        currentPopupImageBase64 = '';
        if (box) {
          box.style.display = 'none';
          box.classList.add('hidden');
        }
        if (previewImg) {
          previewImg.src = '';
          previewImg.removeAttribute('src');
        }
      }

      // Deposit address
      const depositAddrInput = document.getElementById('admin-deposit-address-input');
      if (depositAddrInput) {
        depositAddrInput.value = settingsMap.usdt_deposit_address || '';
      }
    }
  } catch (err) {
    console.error('Failed to load admin settings:', err);
  }
}

async function handleSaveTickerNotice(e) {
  e.preventDefault();
  const value = document.getElementById('admin-ticker-input')?.value.trim();
  if (!value) return;

  try {
    const res = await fetch(`${API_BASE}/admin/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ key: 'announcement_ticker', value })
    });
    const data = await res.json();
    if (data.success) {
      if (!publicAnnouncementsCache) publicAnnouncementsCache = {};
      publicAnnouncementsCache.announcementTicker = value;

      const tickerEl = document.getElementById('home-ticker-text');
      if (tickerEl) tickerEl.textContent = value;
      showToast('Scrolling notification message updated live!', 'success');
    } else {
      showToast(data.error || 'Failed to update ticker', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleSaveTickerNotice = handleSaveTickerNotice;

async function handleSaveAdminDepositAddress(e) {
  e.preventDefault();
  const value = document.getElementById('admin-deposit-address-input')?.value.trim();
  if (!value) { showToast('Please enter a valid BEP-20 address', 'error'); return; }
  if (!value.startsWith('0x') || value.length < 10) {
    showToast('BEP-20 address must start with 0x and be a valid wallet address', 'error');
    return;
  }

  const btn = document.getElementById('btn-save-deposit-address');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Updating...';
  }

  try {
    const res = await fetch(`${API_BASE}/admin/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ key: 'usdt_deposit_address', value })
    });
    const data = await res.json();
    if (data.success) {
      updateRechargeModalAddress(value);
      if (currentUser && (currentUser.role === 'admin' || currentUser.id === 1)) {
        currentUser.usdt_address = value;
        updateAuthUI();
      }
      const curDisp = document.getElementById('bep20-current-display');
      if (curDisp) curDisp.textContent = value;
      const bepInp = document.getElementById('bep20-address-input');
      if (bepInp) bepInp.value = value;
      showToast('Official deposit address updated & synced to all members!', 'success');
    } else {
      showToast(data.error || 'Failed to update deposit address', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Update Official Deposit Address';
    }
  }
}
window.handleSaveAdminDepositAddress = handleSaveAdminDepositAddress;

async function handleAdminSaveUserWalletAddress() {
  if (!currentInspectedUserId) { showToast('No user selected', 'error'); return; }
  const walletAddress = document.getElementById('aud-usdt-input')?.value.trim();
  if (!walletAddress) { showToast('Please enter wallet address', 'error'); return; }

  try {
    const res = await fetch(`${API_BASE}/admin/users/${currentInspectedUserId}/wallet-address`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ walletAddress })
    });
    const data = await res.json();
    if (data.success) {
      const audUsdt = document.getElementById('aud-usdt');
      if (audUsdt) audUsdt.textContent = walletAddress;

      // If inspected user is admin, immediately sync deposit address & profile
      if (currentInspectedUserId === 1 || (currentUser && currentUser.id === currentInspectedUserId && currentUser.role === 'admin')) {
        updateRechargeModalAddress(walletAddress);
        const depInp = document.getElementById('admin-deposit-address-input');
        if (depInp) depInp.value = walletAddress;
        if (currentUser && currentUser.id === currentInspectedUserId) {
          currentUser.usdt_address = walletAddress;
          updateAuthUI();
        }
        const curDisp = document.getElementById('bep20-current-display');
        if (curDisp) curDisp.textContent = walletAddress;
      }
      showToast('User wallet address updated successfully!', 'success');
    } else {
      showToast(data.error || 'Failed to update wallet address', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleAdminSaveUserWalletAddress = handleAdminSaveUserWalletAddress;

async function triggerAdminDailyRoi() {
  const btn = document.getElementById('admin-btn-run-roi');
  if (btn && btn.disabled) {
    showToast('Daily ROI cycle is scheduled automatically and cannot be run manually before closing time.', 'info');
    return;
  }
  if (!confirm('Are you sure you want to trigger daily ROI credit for all active plans now?')) return;
  try {
    const res = await fetch(`${API_BASE}/admin/trigger-daily-roi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ force: false })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Daily ROI executed! Processed: ${data.processedInvestments || 0}, Paid: $${(data.totalRoiDistributed || 0).toFixed(2)}`, 'success');
      loadAdminData();
    } else {
      showToast(data.error || 'Failed to trigger ROI', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.triggerAdminDailyRoi = triggerAdminDailyRoi;

function previewAdminPopupImageFile(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = function(e) {
      const rawDataUrl = e.target.result;
      // Auto-compress and downscale image to fit safely under Vercel payload limits (<300KB)
      const img = new Image();
      img.onload = function() {
        const maxWidth = 900;
        const maxHeight = 1200;
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Quality 0.8 JPEG provides ultra crisp graphics while reducing size down to ~80-150 KB
        currentPopupImageBase64 = canvas.toDataURL('image/jpeg', 0.82);

        const urlInput = document.getElementById('admin-popup-url-input');
        if (urlInput) urlInput.value = '';

        // Auto-check "Enable Popup on Login" checkbox so admin doesn't forget
        const chkActive = document.getElementById('admin-popup-active-checkbox');
        if (chkActive) chkActive.checked = true;

        showAdminPopupPreview(currentPopupImageBase64);
        showToast('Image uploaded & optimized successfully!', 'success');
      };
      img.onerror = function() {
        currentPopupImageBase64 = rawDataUrl;
        showAdminPopupPreview(currentPopupImageBase64);
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  }
}
window.previewAdminPopupImageFile = previewAdminPopupImageFile;

function previewAdminPopupImageUrl(url) {
  if (url && url.trim()) {
    currentPopupImageBase64 = url.trim();
    const chkActive = document.getElementById('admin-popup-active-checkbox');
    if (chkActive) chkActive.checked = true;
    showAdminPopupPreview(currentPopupImageBase64);
  } else {
    // If URL input was cleared
    if (!currentPopupImageBase64 || currentPopupImageBase64.startsWith('http')) {
      currentPopupImageBase64 = '';
      const box = document.getElementById('admin-popup-preview-box');
      if (box) {
        box.style.display = 'none';
        box.classList.add('hidden');
      }
      const img = document.getElementById('admin-popup-preview-img');
      if (img) {
        img.src = '';
        img.removeAttribute('src');
      }
    }
  }
}
window.previewAdminPopupImageUrl = previewAdminPopupImageUrl;

function showAdminPopupPreview(src) {
  const box = document.getElementById('admin-popup-preview-box');
  const img = document.getElementById('admin-popup-preview-img');
  if (box && img && src) {
    img.src = src;
    box.classList.remove('hidden');
    box.style.display = 'flex';
  }
}

async function clearAdminPopupImage(btnElement) {
  const btn = btnElement || document.getElementById('btn-remove-popup') || (typeof event !== 'undefined' ? (event?.currentTarget || event?.target) : null);
  const origText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Removing...';
  }

  // 1. Immediately reset all local memory, inputs, and preview
  currentPopupImageBase64 = '';
  const fileInput = document.getElementById('admin-popup-file-input');
  if (fileInput) fileInput.value = '';
  const urlInput = document.getElementById('admin-popup-url-input');
  if (urlInput) urlInput.value = '';

  const box = document.getElementById('admin-popup-preview-box');
  if (box) {
    box.style.display = 'none';
    box.classList.add('hidden');
  }
  const previewImg = document.getElementById('admin-popup-preview-img');
  if (previewImg) {
    previewImg.src = '';
    previewImg.removeAttribute('src');
  }

  const chkActive = document.getElementById('admin-popup-active-checkbox');
  if (chkActive) chkActive.checked = false;

  // 2. Persist deletion immediately to backend database
  try {
    const token = localStorage.getItem('token') || localStorage.getItem('authToken');
    if (token) {
      const res = await fetch(`${API_BASE}/admin/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          settings: {
            popup_image_url: '',
            popup_image_active: '0'
          }
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to remove popup image from server');
    }

    // 3. Clear public cache
    if (!publicAnnouncementsCache) publicAnnouncementsCache = {};
    publicAnnouncementsCache.popupImageUrl = '';
    publicAnnouncementsCache.popupImageActive = false;

    // 4. Close any open preview modal
    closeModal('memberLoginPopupModal');

    showToast('Pop image removed successfully!', 'success');
  } catch (err) {
    console.error('Failed to remove pop image:', err);
    showToast(err.message || 'Error removing popup image', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origText || 'Remove Pop Image';
    }
  }
}
window.clearAdminPopupImage = clearAdminPopupImage;

async function handleSavePopupImage(e) {
  e.preventDefault();
  const urlVal = document.getElementById('admin-popup-url-input')?.value.trim();
  const finalImage = urlVal || currentPopupImageBase64 || '';
  // If an image exists and admin clicked save, default to active unless explicitly unchecked
  const chkActive = document.getElementById('admin-popup-active-checkbox');
  const isActive = chkActive ? (chkActive.checked ? '1' : '0') : (finalImage ? '1' : '0');
  const title = document.getElementById('admin-popup-title-input')?.value.trim() || 'Special Platform Announcement';

  if (isActive === '1' && !finalImage) {
    showToast('Please upload an image file or provide an Image URL first', 'error');
    return;
  }

  const saveBtn = e.target.querySelector('button[type="submit"]') || document.getElementById('btn-save-popup');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    // Single batch request to update all popup settings simultaneously
    const res = await fetch(`${API_BASE}/admin/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        settings: {
          popup_image_url: finalImage,
          popup_image_active: isActive,
          popup_image_title: title
        }
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to save settings');

    // Update in-memory public announcement cache immediately
    if (!publicAnnouncementsCache) publicAnnouncementsCache = {};
    publicAnnouncementsCache.popupImageUrl = finalImage;
    publicAnnouncementsCache.popupImageActive = (isActive === '1');
    publicAnnouncementsCache.popupImageTitle = title;

    // Reset session flag so admin can immediately see the popup when viewing member portal
    hasShownLoginPopupThisSession = false;

    showToast('Member login pop image announcement saved live!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save & Update Pop Image';
    }
  }
}
window.handleSavePopupImage = handleSavePopupImage;

let hasShownLoginPopupThisSession = false;

function checkAndShowMemberLoginPopup(imgUrl, title, force = false) {
  if (!imgUrl) return;
  if (!force && hasShownLoginPopupThisSession) return;
  // Don't show popup on purely auth pages or inside admin dashboard
  if (activeViewName === 'login' || activeViewName === 'register' || activeViewName === 'adminlogin' || activeViewName === 'admin') return;

  const modalImg = document.getElementById('login-popup-img');
  const modalTitle = document.getElementById('login-popup-title');
  if (modalImg) modalImg.src = imgUrl;
  if (modalTitle && title) modalTitle.textContent = title;

  hasShownLoginPopupThisSession = true;
  setTimeout(() => {
    openModal('memberLoginPopupModal');
  }, 400);
}
window.checkAndShowMemberLoginPopup = checkAndShowMemberLoginPopup;

function previewMemberLoginPopupDirectly() {
  const urlVal = document.getElementById('admin-popup-url-input')?.value.trim();
  const finalImage = urlVal || currentPopupImageBase64 || (publicAnnouncementsCache && publicAnnouncementsCache.popupImageUrl);
  const title = document.getElementById('admin-popup-title-input')?.value.trim() || 'Special Platform Announcement';
  if (!finalImage) {
    showToast('No pop image uploaded or configured yet!', 'info');
    return;
  }
  const modalImg = document.getElementById('login-popup-img');
  const modalTitle = document.getElementById('login-popup-title');
  if (modalImg) modalImg.src = finalImage;
  if (modalTitle) modalTitle.textContent = title;
  openModal('memberLoginPopupModal');
}
window.previewMemberLoginPopupDirectly = previewMemberLoginPopupDirectly;

// ==================== ADMIN PLATFORM SETTINGS (ROI Time, Commission Levels) ====================

let teamCommissionLevelsData = [];
let teamRoiLevelsData = [];

function renderCommissionLevelRow(container, levels, type) {
  container.innerHTML = '';
  levels.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    row.innerHTML = `
      <span class="text-xs font-bold text-slate-300 w-16 shrink-0">Level ${item.level}</span>
      <input type="number" step="0.1" min="0" max="100" value="${item.rate}" onchange="updateCommissionLevel('${type}', ${idx}, this.value)" class="flex-1 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:outline-none focus:border-amber-400">
      <span class="text-xs text-slate-400">%</span>
      <button type="button" onclick="removeCommissionLevel('${type}', ${idx})" class="p-1 rounded-lg bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 transition active:scale-95 cursor-pointer">
        <i data-lucide="trash-2" class="w-3 h-3"></i>
      </button>
    `;
    container.appendChild(row);
  });
  if (window.lucide) lucide.createIcons();
}

function updateCommissionLevel(type, idx, value) {
  const arr = type === 'commission' ? teamCommissionLevelsData : teamRoiLevelsData;
  if (arr[idx]) arr[idx].rate = parseFloat(value) || 0;
}
window.updateCommissionLevel = updateCommissionLevel;

function removeCommissionLevel(type, idx) {
  if (type === 'commission') {
    teamCommissionLevelsData.splice(idx, 1);
    teamCommissionLevelsData.forEach((item, i) => item.level = i + 1);
    renderCommissionLevelRow(document.getElementById('team-commission-levels-container'), teamCommissionLevelsData, 'commission');
  } else {
    teamRoiLevelsData.splice(idx, 1);
    teamRoiLevelsData.forEach((item, i) => item.level = i + 1);
    renderCommissionLevelRow(document.getElementById('team-roi-levels-container'), teamRoiLevelsData, 'roi');
  }
}
window.removeCommissionLevel = removeCommissionLevel;

function addTeamCommissionLevel() {
  const nextLevel = teamCommissionLevelsData.length + 1;
  teamCommissionLevelsData.push({ level: nextLevel, rate: 0 });
  renderCommissionLevelRow(document.getElementById('team-commission-levels-container'), teamCommissionLevelsData, 'commission');
}
window.addTeamCommissionLevel = addTeamCommissionLevel;

function addTeamRoiLevel() {
  const nextLevel = teamRoiLevelsData.length + 1;
  teamRoiLevelsData.push({ level: nextLevel, rate: 0 });
  renderCommissionLevelRow(document.getElementById('team-roi-levels-container'), teamRoiLevelsData, 'roi');
}
window.addTeamRoiLevel = addTeamRoiLevel;

async function handleSaveRoiClosingTime(e) {
  e.preventDefault();
  const timeVal = document.getElementById('admin-roi-closing-time')?.value;
  if (!timeVal) { showToast('Please select a valid time', 'error'); return; }

  try {
    const res = await fetch(`${API_BASE}/admin/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ key: 'roi_closing_time', value: timeVal })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`ROI closing time updated to ${timeVal}!`, 'success');
    } else {
      showToast(data.error || 'Failed to update ROI closing time', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleSaveRoiClosingTime = handleSaveRoiClosingTime;

async function handleSaveTeamCommissionLevels() {
  if (teamCommissionLevelsData.length === 0) { showToast('Add at least one commission level', 'error'); return; }
  try {
    const res = await fetch(`${API_BASE}/admin/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ key: 'team_commission_levels', value: JSON.stringify(teamCommissionLevelsData) })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Team commission levels saved successfully!', 'success');
    } else {
      showToast(data.error || 'Failed to save commission levels', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleSaveTeamCommissionLevels = handleSaveTeamCommissionLevels;

async function handleSaveTeamRoiLevels() {
  if (teamRoiLevelsData.length === 0) { showToast('Add at least one ROI level', 'error'); return; }
  try {
    const res = await fetch(`${API_BASE}/admin/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ key: 'team_roi_levels', value: JSON.stringify(teamRoiLevelsData) })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Team ROI of ROI levels saved successfully!', 'success');
    } else {
      showToast(data.error || 'Failed to save ROI levels', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleSaveTeamRoiLevels = handleSaveTeamRoiLevels;

async function handleSaveMinWithdrawal(e) {
  e.preventDefault();
  const minVal = parseFloat(document.getElementById('admin-min-withdrawal')?.value);
  if (isNaN(minVal) || minVal < 1) {
    showToast('Please enter a valid minimum withdrawal amount (at least 1 USDT)', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ key: 'min_withdrawal', value: String(minVal) })
    });
    const data = await res.json();
    if (data.success) {
      currentMinWithdrawal = minVal;
      const minDisp = document.getElementById('withdraw-min-display');
      if (minDisp) minDisp.textContent = `${minVal} USDT`;
      const amtInput = document.getElementById('withdraw-amount');
      if (amtInput) {
        amtInput.min = minVal;
        amtInput.placeholder = `Min ${minVal}`;
      }
      showToast(`Minimum withdrawal limit saved: ${minVal} USDT!`, 'success');
    } else {
      showToast(data.error || 'Failed to update minimum withdrawal', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleSaveMinWithdrawal = handleSaveMinWithdrawal;

function loadAdminPlatformSettings() {
  // Load settings from server and populate the settings tab
  if (!token) return;
  fetch(`${API_BASE}/admin/settings`, {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(r => r.json()).then(data => {
    if (data.success && data.settings) {
      const settingsMap = data.settings.reduce((acc, row) => { acc[row.key] = row.value; return acc; }, {});

      // ROI closing time
      const roiTimeInput = document.getElementById('admin-roi-closing-time');
      if (roiTimeInput) roiTimeInput.value = settingsMap.roi_closing_time || '00:00';

      // Minimum withdrawal limit
      const minWithdrawalInput = document.getElementById('admin-min-withdrawal');
      if (minWithdrawalInput) minWithdrawalInput.value = settingsMap.min_withdrawal || '15';

      // Team commission levels
      try {
        teamCommissionLevelsData = JSON.parse(settingsMap.team_commission_levels || '[]');
      } catch(e) {
        teamCommissionLevelsData = [];
      }
      if (teamCommissionLevelsData.length === 0) {
        // Default: L1=6%, L2=2%, L3=1%
        teamCommissionLevelsData = [
          { level: 1, rate: 6 },
          { level: 2, rate: 2 },
          { level: 3, rate: 1 }
        ];
      }
      renderCommissionLevelRow(document.getElementById('team-commission-levels-container'), teamCommissionLevelsData, 'commission');

      // Team ROI levels
      try {
        teamRoiLevelsData = JSON.parse(settingsMap.team_roi_levels || '[]');
      } catch(e) {
        teamRoiLevelsData = [];
      }
      if (teamRoiLevelsData.length === 0) {
        // Default: L1=10%, L2=4%, L3=2%
        teamRoiLevelsData = [
          { level: 1, rate: 10 },
          { level: 2, rate: 4 },
          { level: 3, rate: 2 }
        ];
      }
      renderCommissionLevelRow(document.getElementById('team-roi-levels-container'), teamRoiLevelsData, 'roi');
    }
  }).catch(err => console.error('Failed to load platform settings:', err));
}

// ==================== SUPER ROOT ADMIN: TEAM ADMINS MANAGEMENT ====================

async function loadTeamAdminsList() {
  const container = document.getElementById('team-admins-list');
  if (!container) return;

  try {
    const res = await fetch(`${API_BASE}/admin/team-admins`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.success || !data.teamAdmins) {
      container.innerHTML = `<div class="text-center py-8 text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">Failed to load team administrators</div>`;
      return;
    }

    const teamAdmins = data.teamAdmins;
    const badgeEl = document.getElementById('admin-badge-teamadmins');
    if (badgeEl) {
      badgeEl.textContent = teamAdmins.length;
      badgeEl.classList.remove('hidden');
    }

    if (teamAdmins.length === 0) {
      container.innerHTML = `<div class="text-center py-8 text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">No team administrators configured yet. Click "Add New Team Admin" above.</div>`;
      return;
    }

    container.innerHTML = teamAdmins.map(ta => {
      const inviteUrl = `${window.location.origin}/?ref=${encodeURIComponent(ta.referral_code || ta.username)}`;
      const isSelected = String(adminCurrentScope.selectedTeamId) === String(ta.id);
      return `
        <div class="p-4 rounded-2xl bg-slate-900/90 border ${isSelected ? 'border-purple-500/80 shadow-purple-500/10' : 'border-slate-800'} hover:border-slate-700 transition space-y-3.5 shadow-md">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white font-extrabold text-sm flex items-center justify-center shrink-0 shadow-md shadow-purple-500/20">
                ${(ta.team_name || ta.username || 'T')[0].toUpperCase()}
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h4 class="font-extrabold text-white text-sm truncate">${ta.team_name || 'Unnamed Team'}</h4>
                  <span class="text-slate-400 font-mono text-xs">(@${ta.username})</span>
                </div>
                <div class="text-[11px] text-slate-400 font-mono flex items-center gap-2 mt-0.5 flex-wrap">
                  <span>Ref: <strong class="text-amber-400">${ta.referral_code || ta.username}</strong></span>
                  <span class="text-slate-600">&bull;</span>
                  <span>Email: <span class="text-slate-300">${ta.email || 'None'}</span></span>
                </div>
              </div>
            </div>
            <div class="flex flex-col items-end gap-1.5 shrink-0">
              <span class="text-[9px] uppercase px-2 py-0.5 rounded-full font-bold font-mono ${ta.status === 'active' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'} flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full ${ta.status === 'active' ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
                ${ta.status}
              </span>
              <span class="text-[9px] text-slate-500 font-mono">Admin ID #${ta.id}</span>
            </div>
          </div>

          <!-- Team Metric Chips -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
            <div class="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <span class="text-[10px] text-slate-500 font-semibold block uppercase tracking-wider">Team Members</span>
              <span class="text-sm font-extrabold text-white font-mono mt-0.5 block">${ta.team_member_count || 0}</span>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <span class="text-[10px] text-slate-500 font-semibold block uppercase tracking-wider">Deposits Volume</span>
              <span class="text-sm font-extrabold text-emerald-400 font-mono mt-0.5 block">$${parseFloat(ta.team_deposit_volume || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <span class="text-[10px] text-slate-500 font-semibold block uppercase tracking-wider">Active Investments</span>
              <span class="text-sm font-extrabold text-amber-400 font-mono mt-0.5 block">$${parseFloat(ta.team_active_investments || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <span class="text-[10px] text-slate-500 font-semibold block uppercase tracking-wider">Withdrawals</span>
              <span class="text-sm font-extrabold text-rose-400 font-mono mt-0.5 block">$${parseFloat(ta.team_withdrawal_volume || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>

          <!-- Team Invite Link Row -->
          <div class="p-2.5 rounded-xl bg-purple-950/20 border border-purple-500/20 flex items-center justify-between gap-2">
            <div class="min-w-0 flex items-center gap-2">
              <i data-lucide="link" class="w-3.5 h-3.5 text-purple-400 shrink-0"></i>
              <span class="font-mono text-[11px] text-purple-200 truncate select-all">${inviteUrl}</span>
            </div>
            <button type="button" onclick="copyTeamAdminInviteLink('${ta.referral_code || ta.username}')" class="px-2.5 py-1 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 font-bold text-[10px] shrink-0 transition active:scale-95 cursor-pointer">
              Copy Link
            </button>
          </div>

          <!-- Actions Row -->
          <div class="flex items-center gap-2 pt-1 border-t border-slate-800/80 flex-wrap">
            <button type="button" onclick="filterSuperAdminToTeam(${ta.id})" class="flex-1 min-w-[120px] py-2 px-3 rounded-xl ${isSelected ? 'bg-purple-500 text-white' : 'bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30'} font-bold text-xs transition flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer">
              <i data-lucide="filter" class="w-3.5 h-3.5"></i>
              <span>${isSelected ? 'Viewing Scope ✓' : 'Filter Scope'}</span>
            </button>
            <button type="button" onclick="openEditTeamAdminModal(${ta.id}, '${ta.username}', '${ta.team_name || ''}', '${ta.status}', '${ta.usdt_address || ''}')" class="py-2 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer border border-slate-700">
              <i data-lucide="settings" class="w-3.5 h-3.5"></i>
              <span>Configure</span>
            </button>
            <button type="button" onclick="openQuickVaultAddressModal(${ta.id}, '${ta.username}', '${ta.usdt_address || ''}')" class="py-2 px-3 rounded-xl bg-amber-500/15 border border-amber-500/30 hover:bg-amber-500/25 text-amber-300 font-bold text-xs transition flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer">
              <i data-lucide="wallet" class="w-3.5 h-3.5"></i>
              <span>Vault</span>
            </button>
            <button type="button" onclick="impersonateTeamAdmin(${ta.id})" class="py-2 px-3.5 rounded-xl bg-amber-500/20 border border-amber-500/30 hover:bg-amber-500/30 text-amber-300 font-bold text-xs transition flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer">
              <i data-lucide="log-in" class="w-3.5 h-3.5"></i>
              <span>Impersonate</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error loading team admins:', err);
    container.innerHTML = `<div class="text-center py-8 text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">Error loading team admins: ${err.message}</div>`;
  }
}
window.loadTeamAdminsList = loadTeamAdminsList;

function openCreateTeamAdminModal() {
  const form = document.getElementById('create-team-admin-form');
  if (form) form.reset();
  openModal('createTeamAdminModal');
}
window.openCreateTeamAdminModal = openCreateTeamAdminModal;

async function handleCreateTeamAdminSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('cta-username')?.value.trim();
  const team_name = document.getElementById('cta-team-name')?.value.trim();
  const email = document.getElementById('cta-email')?.value.trim();
  const referral_code = document.getElementById('cta-refcode')?.value.trim();
  const password = document.getElementById('cta-password')?.value;
  const btn = document.getElementById('btn-create-team-admin-submit');

  if (!username || !team_name || !email || !password) {
    showToast('Please fill all required fields', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Creating Team Admin...';
  }

  try {
    const res = await fetch(`${API_BASE}/admin/team-admins`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ username, team_name, email, referral_code, password })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Team Admin @${username} created successfully!`, 'success');
      closeModal('createTeamAdminModal');
      await loadAdminData();
      await loadTeamAdminsList();
    } else {
      showToast(data.error || 'Failed to create team admin', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Create Team Admin Account';
    }
  }
}
window.handleCreateTeamAdminSubmit = handleCreateTeamAdminSubmit;

function openEditTeamAdminModal(id, username, teamName, status, usdtAddress = '') {
  document.getElementById('eta-admin-id').value = id;
  document.getElementById('eta-target-username').textContent = `Configuring @${username}`;
  document.getElementById('eta-team-name').value = teamName || '';
  document.getElementById('eta-status').value = status || 'active';
  document.getElementById('eta-password').value = '';
  const addrInp = document.getElementById('eta-usdt-address');
  if (addrInp) addrInp.value = usdtAddress || '';
  openModal('editTeamAdminModal');
}
window.openEditTeamAdminModal = openEditTeamAdminModal;

async function handleEditTeamAdminSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('eta-admin-id')?.value;
  const team_name = document.getElementById('eta-team-name')?.value.trim();
  const status = document.getElementById('eta-status')?.value;
  const password = document.getElementById('eta-password')?.value;
  const usdt_address = document.getElementById('eta-usdt-address')?.value.trim();
  const btn = document.getElementById('btn-edit-team-admin-submit');

  if (!id) return;

  if (usdt_address && !/^0x[a-fA-F0-9]{40}$/.test(usdt_address)) {
    showToast('Invalid BEP-20 address. Must start with 0x and be 42 characters hex.', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Updating...';
  }

  try {
    const payload = { team_name, status };
    if (password && password.trim().length >= 6) {
      payload.password = password.trim();
    }
    if (usdt_address !== undefined) {
      payload.usdt_address = usdt_address;
    }

    const res = await fetch(`${API_BASE}/admin/team-admins/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('Team Admin updated successfully!', 'success');
      closeModal('editTeamAdminModal');
      await loadAdminData();
      await loadTeamAdminsList();
      if (typeof loadSuperRootMasterDashboard === 'function') {
        await loadSuperRootMasterDashboard();
      }
    } else {
      showToast(data.error || 'Failed to update team admin', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Update Team Admin';
    }
  }
}
window.handleEditTeamAdminSubmit = handleEditTeamAdminSubmit;

async function impersonateTeamAdmin(id) {
  if (!confirm('Switch session and enter this Team Admin portal? You will operate as this team admin.')) return;
  try {
    const res = await fetch(`${API_BASE}/admin/team-admins/${id}/impersonate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (data.success) {
      token = data.token;
      currentUser = data.user;
      localStorage.setItem('catalyst_token', token);
      showToast(`Switched into ${currentUser.team_name || currentUser.username} Admin Portal!`, 'success');
      updateAuthUI();
      navigate('admin');
      await loadAdminData();
    } else {
      showToast(data.error || 'Failed to impersonate team admin', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.impersonateTeamAdmin = impersonateTeamAdmin;

// ========================================================
// SUPER ROOT ADMIN: MASTER COMMANDER DASHBOARD SYSTEM
// (Dubai Finance & Seoralink Reference Implementations)
// ========================================================

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
window.escapeHtml = escapeHtml;

let cachedSuperRootBranches = [];
let currentInspectedBranchId = null;
let universalMemberSearchTimer = null;

// 1. Enter Portal As Admin (Super Root Impersonation of any Sub-Admin)
async function enterPortalAsAdmin(adminId) {
  try {
    const origSuperToken = localStorage.getItem('catalyst_superadmin_orig_token');
    if (!origSuperToken) {
      localStorage.setItem('catalyst_superadmin_orig_token', token);
    }

    const res = await fetch(`${API_BASE}/admin/team-admins/${adminId}/impersonate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (!data.success || !data.token) throw new Error(data.error || 'Failed to switch into branch portal');

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('catalyst_token', token);

    showToast(`👑 Operating as Sub-Admin @${currentUser.username} (${currentUser.team_name || 'Team Admin'})!`, 'success');
    updateAuthUI();
    navigate('admin');
    await loadAdminData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.enterPortalAsAdmin = enterPortalAsAdmin;

// 2. Enter Portal As Member (Super Root or Admin Impersonation of any Member)
async function enterPortalAsMember(memberId) {
  try {
    if (currentUser?.role === 'superadmin') {
      const origSuperToken = localStorage.getItem('catalyst_superadmin_orig_token');
      if (!origSuperToken) {
        localStorage.setItem('catalyst_superadmin_orig_token', token);
      }
    } else if (currentUser?.role === 'admin') {
      if (!originalAdminToken) {
        originalAdminToken = token;
        localStorage.setItem('catalyst_admin_orig_token', originalAdminToken);
      }
    }

    const res = await fetch(`${API_BASE}/admin/impersonate/${memberId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (!data.success || !data.token) throw new Error(data.error || 'Failed to switch into member portal');

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('catalyst_token', token);

    closeModal('adminUserDetailModal');
    showToast(`👑 Operating as Member @${currentUser.username}!`, 'info');
    updateAuthUI();
    navigate('home');
    await refreshCurrentViewData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.enterPortalAsMember = enterPortalAsMember;

// 3. Exit Super Root Impersonation (Return to Super Root Master Commander)
async function exitSuperRootImpersonation() {
  const origSuperToken = localStorage.getItem('catalyst_superadmin_orig_token');
  if (!origSuperToken) return;

  token = origSuperToken;
  localStorage.setItem('catalyst_token', token);
  localStorage.removeItem('catalyst_superadmin_orig_token');

  const banner = document.getElementById('super-root-impersonation-bar');
  if (banner) banner.classList.add('hidden');
  document.body.classList.remove('has-sr-impersonation-bar');

  await fetchUserProfile();
  showToast('Returned to Super Root Master Commander!', 'success');
  navigate('admin');
  await loadAdminData();
}
window.exitSuperRootImpersonation = exitSuperRootImpersonation;

// 4. Load Super Root Master Dashboard
async function loadSuperRootMasterDashboard() {
  try {
    const res = await fetch(`${API_BASE}/admin/team-admins`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to load branch records');

    cachedSuperRootBranches = data.teamAdmins || [];

    const totalBranches = cachedSuperRootBranches.length;
    const activeBranches = cachedSuperRootBranches.filter(b => b.status === 'active').length;
    const totalMembers = cachedSuperRootBranches.reduce((s, b) => s + (parseInt(b.total_members) || 0), 0);
    const activeInvestors = cachedSuperRootBranches.reduce((s, b) => s + (parseInt(b.active_investors) || 0), 0);
    const totalDeposits = cachedSuperRootBranches.reduce((s, b) => s + (parseFloat(b.total_deposits) || 0), 0);
    const totalWithdrawals = cachedSuperRootBranches.reduce((s, b) => s + (parseFloat(b.total_withdrawals) || 0), 0);

    // Update 4 Hero Metric Cards
    const elBranches = document.getElementById('sr-stat-branches');
    if (elBranches) elBranches.textContent = totalBranches;
    const elMembers = document.getElementById('sr-stat-members');
    if (elMembers) elMembers.textContent = totalMembers;
    const elActiveInv = document.getElementById('sr-stat-active-investors');
    if (elActiveInv) elActiveInv.textContent = activeInvestors;
    const elDeposits = document.getElementById('sr-stat-deposits');
    if (elDeposits) elDeposits.textContent = `$${totalDeposits.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const elPayouts = document.getElementById('sr-stat-payouts');
    if (elPayouts) elPayouts.textContent = `$${totalWithdrawals.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const badgeBranches = document.getElementById('sr-badge-branches-count');
    if (badgeBranches) badgeBranches.textContent = totalBranches;
    const activeBadge = document.getElementById('sr-branches-active-badge');
    if (activeBadge) activeBadge.textContent = `(${activeBranches} Active Branches)`;
    const headerUser = document.getElementById('sr-header-user');
    if (headerUser && currentUser) headerUser.textContent = `SUPER ROOT (@${currentUser.username})`;

    // Populate Inspector Select Dropdown
    const inspectSelect = document.getElementById('sr-inspector-branch-select');
    if (inspectSelect) {
      inspectSelect.innerHTML = `<option value="">Choose a branch to inspect...</option>` +
        cachedSuperRootBranches.map(b => `<option value="${b.id}">${b.team_name || b.username} (@${b.username})</option>`).join('');
      if (currentInspectedBranchId) inspectSelect.value = String(currentInspectedBranchId);
    }

    // Populate Branch Status Quick Controls in Tab 7
    const quickControls = document.getElementById('sr-branch-quick-controls');
    if (quickControls) {
      quickControls.innerHTML = cachedSuperRootBranches.map(b => `
        <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
          <div class="min-w-0">
            <span class="font-bold text-white">${b.team_name || b.username}</span>
            <span class="text-[10px] text-slate-400 font-mono ml-1">(@${b.username})</span>
          </div>
          <button onclick="toggleTeamAdminStatus(${b.id})" class="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition ${b.status === 'active' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'}">
            ${b.status === 'active' ? 'Active' : 'Suspended'}
          </button>
        </div>
      `).join('');
    }

    renderSuperRootBranchesTable(cachedSuperRootBranches);
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.loadSuperRootMasterDashboard = loadSuperRootMasterDashboard;

// 5. Render Super Root Branches Table (Tab 1)
function renderSuperRootBranchesTable(branches) {
  const tbody = document.getElementById('sr-branches-table-body');
  if (!tbody) return;

  if (!branches || branches.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-500">No sub-admin branches registered yet</td></tr>`;
    return;
  }

  tbody.innerHTML = branches.map((b, idx) => {
    const num = String(idx + 1).padStart(2, '0');
    const isAct = (b.status === 'active');
    const depVol = parseFloat(b.total_deposits || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const wthVol = parseFloat(b.total_withdrawals || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const vaultShort = b.usdt_address ? `${b.usdt_address.substring(0, 6)}...${b.usdt_address.substring(b.usdt_address.length - 4)}` : null;

    return `
      <tr class="hover:bg-slate-800/40 transition">
        <td class="py-3 px-4">
          <div class="flex items-center gap-2.5">
            <span class="w-7 h-7 rounded-lg bg-slate-800 text-slate-300 font-mono text-[11px] font-bold flex items-center justify-center shrink-0 border border-slate-700/60">${num}</span>
            <div class="min-w-0">
              <div class="font-extrabold text-white text-xs truncate">${b.team_name || b.username}</div>
              <div class="flex items-center gap-2 mt-0.5 flex-wrap">
                <span class="text-[10px] text-slate-400 font-mono">@${b.username}</span>
                <button onclick="enterPortalAsAdmin(${b.id})" class="text-[10px] text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1 bg-cyan-500/10 hover:bg-cyan-500/20 px-2 py-0.5 rounded border border-cyan-500/30 transition cursor-pointer">
                  <i data-lucide="external-link" class="w-3 h-3"></i>
                  <span>Portal</span>
                </button>
              </div>
            </div>
          </div>
        </td>
        <td class="py-3 px-4">
          <div class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono text-[11px] font-bold">
            <span>${b.referral_code || b.username}</span>
          </div>
        </td>
        <td class="py-3 px-4">
          <div class="text-[11px] text-slate-300 font-mono truncate max-w-[170px]">${b.email || 'N/A'}</div>
          <div class="text-[10px] text-slate-400 font-mono">${b.phone || 'N/A'}</div>
          ${vaultShort ? `
            <div class="mt-1">
              <button onclick="openQuickVaultAddressModal(${b.id}, '${escapeHtml(b.username)}', '${escapeHtml(b.usdt_address || '')}')" title="Click to modify Vault: ${b.usdt_address}" class="text-[9px] text-amber-300 hover:text-amber-200 font-mono flex items-center gap-1 bg-amber-500/10 hover:bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-500/30 transition cursor-pointer">
                <i data-lucide="wallet" class="w-2.5 h-2.5 shrink-0 text-amber-400"></i>
                <span class="truncate">Vault: ${vaultShort}</span>
              </button>
            </div>
          ` : `
            <div class="mt-1">
              <button onclick="openQuickVaultAddressModal(${b.id}, '${escapeHtml(b.username)}', '')" title="Assign Vault Address" class="text-[9px] text-slate-400 hover:text-amber-300 font-mono flex items-center gap-1 bg-slate-800/80 hover:bg-amber-500/15 px-1.5 py-0.5 rounded border border-slate-700/60 hover:border-amber-500/30 transition cursor-pointer">
                <i data-lucide="wallet" class="w-2.5 h-2.5 shrink-0 text-amber-400"></i>
                <span>+ Set Vault</span>
              </button>
            </div>
          `}
        </td>
        <td class="py-3 px-4">
          <div class="font-bold text-white text-xs">${b.total_members || 0} Members</div>
          <div class="text-[10px] text-emerald-400 font-semibold">${b.active_investors || 0} Active</div>
        </td>
        <td class="py-3 px-4">
          <div class="font-extrabold text-emerald-400 font-mono text-xs">$${depVol}</div>
          <div class="text-[10px] text-slate-400 font-mono">Payouts: $${wthVol}</div>
        </td>
        <td class="py-3 px-4">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1 ${isAct ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'}">
            <span>${isAct ? '● ACTIVE' : '⛔ SUSPENDED'}</span>
          </span>
        </td>
        <td class="py-3 px-4 text-right">
          <div class="inline-flex items-center gap-1.5 justify-end flex-wrap">
            <button onclick="enterPortalAsAdmin(${b.id})" title="Enter Sub-Admin Portal" class="px-2.5 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 transition text-xs font-bold flex items-center gap-1 active:scale-95 cursor-pointer">
              <i data-lucide="log-in" class="w-3.5 h-3.5"></i>
              <span>Enter Portal</span>
            </button>
            <button onclick="inspectBranchFromBranchesTab(${b.id})" title="Inspect Branch" class="px-2.5 py-1.5 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/25 transition text-xs font-bold flex items-center gap-1 active:scale-95 cursor-pointer">
              <i data-lucide="eye" class="w-3.5 h-3.5"></i>
              <span>Inspect</span>
            </button>
            <button onclick="openEditTeamAdminModal(${b.id}, '${escapeHtml(b.username)}', '${escapeHtml(b.team_name || '')}', '${b.status}', '${escapeHtml(b.usdt_address || '')}')" title="Configure Branch" class="p-1.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 hover:bg-rose-500/25 transition text-xs font-bold flex items-center gap-1 active:scale-95 cursor-pointer">
              <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="openQuickVaultAddressModal(${b.id}, '${escapeHtml(b.username)}', '${escapeHtml(b.usdt_address || '')}')" title="Modify Vault Address (BEP-20)" class="p-1.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 transition text-xs font-bold flex items-center gap-1 active:scale-95 cursor-pointer">
              <i data-lucide="wallet" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="openQuickPasswordResetModal(${b.id}, '${escapeHtml(b.username)}')" title="Reset Password" class="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition text-xs border border-slate-700 active:scale-95 cursor-pointer">
              <i data-lucide="key" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="toggleTeamAdminStatus(${b.id})" title="${isAct ? 'Suspend Branch' : 'Activate Branch'}" class="p-1.5 rounded-xl ${isAct ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'} transition text-xs active:scale-95 cursor-pointer">
              <i data-lucide="${isAct ? 'lock' : 'unlock'}" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

// 6. Switch Super Root Tab
function switchSuperRootTab(tabName) {
  const tabs = ['branches', 'inspector', 'universal', 'config', 'credit-debit', 'logs', 'bep20'];
  tabs.forEach(t => {
    const btn = document.getElementById(`sr-tab-btn-${t}`);
    const content = document.getElementById(`sr-tab-content-${t}`);
    if (btn) btn.classList.toggle('active', t === tabName);
    if (content) content.classList.toggle('hidden', t !== tabName);
  });

  if (tabName === 'universal') searchUniversalMembers('');
  if (tabName === 'logs') loadSuperRootAuditLogs();
  if (tabName === 'config') {
    // Load config into inputs
    loadAdminPlatformSettings().then(() => {
      const srcRoi = document.getElementById('admin-roi-closing-time')?.value;
      const srcMin = document.getElementById('admin-min-withdrawal')?.value;
      const targetRoi = document.getElementById('sr-config-roi-time');
      const targetMin = document.getElementById('sr-config-min-withdrawal');
      if (targetRoi && srcRoi) targetRoi.value = srcRoi;
      if (targetMin && srcMin) targetMin.value = srcMin;
    });
  }
  if (tabName === 'bep20') {
    const addr = currentUser?.usdt_address || document.getElementById('admin-deposit-address-input')?.value;
    const inp = document.getElementById('sr-bep20-address-input');
    const link = document.getElementById('sr-bep20-bscscan-link');
    if (inp && addr) inp.value = addr;
    if (link && addr) link.href = `https://bscscan.com/address/${addr}`;
  }

  if (window.lucide) lucide.createIcons();
  const activeBtn = document.getElementById(`sr-tab-btn-${tabName}`);
  if (activeBtn) {
    activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
  setTimeout(() => updateTabSlideArrowStates('sr-tabs-container'), 300);
}
window.switchSuperRootTab = switchSuperRootTab;

// 7. Filter Branches (Search Input in Tab 1)
function filterSuperRootBranches() {
  const q = document.getElementById('sr-branch-search-input')?.value.trim().toLowerCase() || '';
  if (!q) {
    renderSuperRootBranchesTable(cachedSuperRootBranches);
    return;
  }
  const filtered = cachedSuperRootBranches.filter(b =>
    (b.username && b.username.toLowerCase().includes(q)) ||
    (b.team_name && b.team_name.toLowerCase().includes(q)) ||
    (b.referral_code && b.referral_code.toLowerCase().includes(q)) ||
    (b.email && b.email.toLowerCase().includes(q)) ||
    (b.phone && b.phone.includes(q))
  );
  renderSuperRootBranchesTable(filtered);
}
window.filterSuperRootBranches = filterSuperRootBranches;

// 8. Inspect Branch from Tab 1
function inspectBranchFromBranchesTab(branchId) {
  currentInspectedBranchId = branchId;
  switchSuperRootTab('inspector');
  const sel = document.getElementById('sr-inspector-branch-select');
  if (sel) sel.value = String(branchId);
  loadBranchInspectorData(branchId);
}
window.inspectBranchFromBranchesTab = inspectBranchFromBranchesTab;

// 9. Load Branch Inspector Data (Tab 2)
async function loadBranchInspectorData(branchId) {
  if (!branchId) return;
  currentInspectedBranchId = branchId;
  const container = document.getElementById('sr-inspector-content-container');
  if (!container) return;

  container.innerHTML = `<div class="py-12 text-center text-slate-500">Loading branch records...</div>`;

  try {
    const res = await fetch(`${API_BASE}/admin/branch-inspector/${branchId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to inspect branch');

    const { branchAdmin, stats, members, deposits, withdrawals } = data;

    container.innerHTML = `
      <!-- Leader & Stats Grid -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <!-- Branch Leader Info Card -->
        <div class="p-4 rounded-3xl bg-slate-900/90 border border-cyan-500/30 space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="text-[10px] uppercase font-bold text-cyan-400">Branch Leader</span>
            <span class="px-2 py-0.5 rounded-full text-[9px] font-bold ${branchAdmin.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}">${branchAdmin.status.toUpperCase()}</span>
          </div>
          <div class="text-base font-extrabold text-white">${branchAdmin.team_name || branchAdmin.username}</div>
          <div class="text-xs text-slate-300 font-mono">@${branchAdmin.username} (ID: ${branchAdmin.id})</div>
          <div class="text-xs text-slate-400 font-mono">${branchAdmin.email || 'N/A'} • ${branchAdmin.phone || 'N/A'}</div>
          <div class="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
            <span class="text-[11px] text-amber-400/90 font-mono truncate" title="${branchAdmin.usdt_address || 'Not Set'}">Vault: ${branchAdmin.usdt_address ? `${branchAdmin.usdt_address.substring(0, 6)}...${branchAdmin.usdt_address.substring(branchAdmin.usdt_address.length - 4)}` : 'None'}</span>
            <button onclick="openQuickVaultAddressModal(${branchAdmin.id}, '${escapeHtml(branchAdmin.username)}', '${escapeHtml(branchAdmin.usdt_address || '')}')" title="Modify Vault Address" class="px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 text-[10px] font-bold flex items-center gap-1 transition cursor-pointer">
              <i data-lucide="wallet" class="w-3 h-3"></i>
              <span>Edit Vault</span>
            </button>
          </div>
          <div class="pt-2 border-t border-slate-800 flex items-center justify-between">
            <span class="text-xs text-slate-400">Wallet Balance:</span>
            <span class="text-sm font-extrabold text-emerald-400 font-mono">$${parseFloat(branchAdmin.wallet_balance || 0).toFixed(2)}</span>
          </div>
          <button onclick="enterPortalAsAdmin(${branchAdmin.id})" class="w-full mt-2 py-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer">
            <i data-lucide="log-in" class="w-3.5 h-3.5"></i>
            <span>Enter @${branchAdmin.username} Admin Portal</span>
          </button>
        </div>

        <!-- Branch Metrics Cards (2 Columns) -->
        <div class="md:col-span-2 grid grid-cols-2 gap-3">
          <div class="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
            <div class="text-[10px] uppercase font-bold text-cyan-400">Total Members</div>
            <div class="text-2xl font-black text-white font-mono mt-1">${stats.totalMembers}</div>
            <div class="text-[10px] text-slate-400 mt-1">Branch Community</div>
          </div>
          <div class="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
            <div class="text-[10px] uppercase font-bold text-emerald-400">Active Investors</div>
            <div class="text-2xl font-black text-emerald-400 font-mono mt-1">${stats.activeMembers}</div>
            <div class="text-[10px] text-slate-400 mt-1">With Live Contracts</div>
          </div>
          <div class="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
            <div class="text-[10px] uppercase font-bold text-emerald-400">Total Deposits Volume</div>
            <div class="text-2xl font-black text-emerald-400 font-mono mt-1">$${parseFloat(stats.totalDepositsVolume || 0).toFixed(2)}</div>
            <div class="text-[10px] text-slate-400 mt-1">Total Inflow</div>
          </div>
          <div class="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
            <div class="text-[10px] uppercase font-bold text-rose-400">Total Withdrawals Volume</div>
            <div class="text-2xl font-black text-rose-400 font-mono mt-1">$${parseFloat(stats.totalWithdrawalsVolume || 0).toFixed(2)}</div>
            <div class="text-[10px] text-slate-400 mt-1">Total Payouts</div>
          </div>
        </div>
      </div>

      <!-- Branch Members Directory Table -->
      <div class="p-4 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-3">
        <div class="flex items-center justify-between">
          <h4 class="text-sm font-extrabold text-white flex items-center gap-2">
            <i data-lucide="users" class="w-4 h-4 text-amber-400"></i>
            <span>Branch Members Directory (${members.length})</span>
          </h4>
        </div>
        <div class="overflow-x-auto rounded-2xl border border-slate-800">
          <table class="w-full text-left text-xs text-slate-300">
            <thead class="bg-slate-950 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-800">
              <tr>
                <th class="py-2.5 px-3">Member Info</th>
                <th class="py-2.5 px-3">Sponsor</th>
                <th class="py-2.5 px-3">Balances (Wallet / ROI / Comm)</th>
                <th class="py-2.5 px-3">Active Invested</th>
                <th class="py-2.5 px-3">Status</th>
                <th class="py-2.5 px-3 text-right">Master Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800/80">
              ${members.length === 0 ? `<tr><td colspan="6" class="py-6 text-center text-slate-500">No members in this branch yet</td></tr>` : members.map(m => `
                <tr class="hover:bg-slate-800/40 transition">
                  <td class="py-2.5 px-3">
                    <div class="font-bold text-white">${m.full_name || m.username}</div>
                    <div class="text-[10px] text-slate-400 font-mono">@${m.username} (ID: ${m.id}) • ${m.email || 'N/A'}</div>
                  </td>
                  <td class="py-2.5 px-3 text-slate-300 font-mono text-[11px]">${m.sponsor_username ? '@' + m.sponsor_username : 'None'}</td>
                  <td class="py-2.5 px-3 font-mono text-[11px]">
                    <span class="text-emerald-400 font-bold">$${parseFloat(m.wallet_balance || 0).toFixed(2)}</span> /
                    <span class="text-amber-400">$${parseFloat(m.roi_balance || 0).toFixed(2)}</span> /
                    <span class="text-purple-400">$${parseFloat(m.commission_balance || 0).toFixed(2)}</span>
                  </td>
                  <td class="py-2.5 px-3 font-mono font-bold ${parseFloat(m.active_invested || 0) > 0 ? 'text-emerald-400' : 'text-slate-400'}">
                    $${parseFloat(m.active_invested || 0).toFixed(2)}
                  </td>
                  <td class="py-2.5 px-3">
                    <span class="px-2 py-0.5 rounded-full text-[9px] font-bold ${m.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}">${m.status.toUpperCase()}</span>
                  </td>
                  <td class="py-2.5 px-3 text-right">
                    <div class="inline-flex items-center gap-1.5 justify-end">
                      <button onclick="enterPortalAsMember(${m.id})" class="px-2 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 text-[11px] font-bold transition flex items-center gap-1 cursor-pointer">
                        <i data-lucide="log-in" class="w-3.5 h-3.5"></i>
                        <span>Enter Member Portal</span>
                      </button>
                      <button onclick="openQuickVaultAddressModal(${m.id}, '${escapeHtml(m.username)}', '${escapeHtml(m.usdt_address || '')}')" title="Modify Vault Address" class="p-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition text-xs cursor-pointer">
                        <i data-lucide="wallet" class="w-3.5 h-3.5"></i>
                      </button>
                      <button onclick="openQuickPasswordResetModal(${m.id}, '${escapeHtml(m.username)}')" title="Reset Password" class="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition text-xs border border-slate-700 cursor-pointer">
                        <i data-lucide="key" class="w-3.5 h-3.5"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    container.innerHTML = `<div class="py-8 text-center text-rose-400 bg-rose-500/10 rounded-2xl border border-rose-500/30">${err.message}</div>`;
  }
}
window.loadBranchInspectorData = loadBranchInspectorData;

// 10. Universal Member Search (Tab 3)
function debounceUniversalMemberSearch() {
  clearTimeout(universalMemberSearchTimer);
  universalMemberSearchTimer = setTimeout(() => {
    const q = document.getElementById('sr-universal-search-input')?.value.trim() || '';
    searchUniversalMembers(q);
  }, 350);
}
window.debounceUniversalMemberSearch = debounceUniversalMemberSearch;

async function searchUniversalMembers(q = '') {
  const tbody = document.getElementById('sr-universal-members-table-body');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_BASE}/admin/universal-members?q=${encodeURIComponent(q)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to search members');

    const members = data.members || [];
    if (members.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-500">No members match your search criteria</td></tr>`;
      return;
    }

    tbody.innerHTML = members.map(m => `
      <tr class="hover:bg-slate-800/40 transition">
        <td class="py-3 px-4">
          <div class="font-extrabold text-white text-xs">${m.full_name || m.username}</div>
          <div class="text-[10px] text-slate-400 font-mono">@${m.username} (ID: ${m.id}) • ${m.email || 'N/A'} • ${m.phone || 'N/A'}</div>
          <div class="flex items-center gap-2 mt-0.5 flex-wrap">
            <span class="text-[9px] text-amber-400/90 font-mono">Ref: ${m.referral_code}</span>
            ${m.usdt_address ? `<span class="text-[9px] text-amber-300 font-mono" title="${m.usdt_address}">Vault: ${m.usdt_address.substring(0, 6)}...${m.usdt_address.slice(-4)}</span>` : ''}
          </div>
        </td>
        <td class="py-3 px-4">
          <div class="text-xs font-bold text-purple-300">${m.team_admin_team_name || m.team_admin_username || 'Default'}</div>
          <div class="text-[10px] text-slate-400 font-mono">@${m.team_admin_username || 'admin'}</div>
        </td>
        <td class="py-3 px-4 text-slate-300 font-mono text-[11px]">${m.sponsor_username ? '@' + m.sponsor_username : 'None'}</td>
        <td class="py-3 px-4 font-mono text-[11px]">
          <div class="text-emerald-400 font-bold">W: $${parseFloat(m.wallet_balance || 0).toFixed(2)}</div>
          <div class="text-amber-400">ROI: $${parseFloat(m.roi_balance || 0).toFixed(2)}</div>
          <div class="text-purple-400">Comm: $${parseFloat(m.commission_balance || 0).toFixed(2)}</div>
        </td>
        <td class="py-3 px-4 font-mono font-bold ${parseFloat(m.active_invested || 0) > 0 ? 'text-emerald-400' : 'text-slate-400'}">
          $${parseFloat(m.active_invested || 0).toFixed(2)}
        </td>
        <td class="py-3 px-4">
          <span class="px-2 py-0.5 rounded-full text-[9px] font-bold ${m.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}">${m.status.toUpperCase()}</span>
        </td>
        <td class="py-3 px-4 text-right">
          <div class="inline-flex items-center gap-1.5 justify-end">
            <button onclick="enterPortalAsMember(${m.id})" class="px-2.5 py-1.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 text-xs font-bold transition flex items-center gap-1 active:scale-95 cursor-pointer">
              <i data-lucide="log-in" class="w-3.5 h-3.5"></i>
              <span>Enter Portal</span>
            </button>
            <button onclick="openQuickVaultAddressModal(${m.id}, '${escapeHtml(m.username)}', '${escapeHtml(m.usdt_address || '')}')" title="Modify Vault Address (BEP-20)" class="p-1.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 transition text-xs cursor-pointer active:scale-95">
              <i data-lucide="wallet" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="openQuickPasswordResetModal(${m.id}, '${escapeHtml(m.username)}')" title="Reset Password" class="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition text-xs border border-slate-700 active:scale-95 cursor-pointer">
              <i data-lucide="key" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-rose-400">${err.message}</td></tr>`;
  }
}
window.searchUniversalMembers = searchUniversalMembers;

// 11. Super Root Audit Logs (Tab 6)
async function loadSuperRootAuditLogs() {
  const tbody = document.getElementById('sr-audit-logs-table-body');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_BASE}/admin/audit-logs`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to load audit logs');

    const logs = data.logs || [];
    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-500">No platform activity recorded yet</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(l => {
      const dt = new Date(l.created_at).toLocaleString();
      return `
        <tr class="hover:bg-slate-800/40 transition">
          <td class="py-2.5 px-3 text-[10px] text-slate-400 font-mono">${dt}</td>
          <td class="py-2.5 px-3">
            <span class="font-bold text-white">@${l.username}</span>
            ${l.team_name ? `<span class="text-[10px] text-purple-300 ml-1">(${l.team_name})</span>` : ''}
          </td>
          <td class="py-2.5 px-3 uppercase text-[10px] font-bold text-slate-300">${l.type}</td>
          <td class="py-2.5 px-3 text-[10px] text-slate-400 font-mono">${l.wallet_type || 'wallet_balance'}</td>
          <td class="py-2.5 px-3 font-mono font-bold ${l.type.includes('withdraw') ? 'text-rose-400' : 'text-emerald-400'}">
            $${parseFloat(l.amount || 0).toFixed(2)}
          </td>
          <td class="py-2.5 px-3 text-[11px] text-slate-300">${l.description || 'N/A'}</td>
          <td class="py-2.5 px-3">
            <span class="px-2 py-0.5 rounded-full text-[9px] font-bold ${l.status === 'completed' || l.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-300'}">${(l.status || 'DONE').toUpperCase()}</span>
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-rose-400">${err.message}</td></tr>`;
  }
}
window.loadSuperRootAuditLogs = loadSuperRootAuditLogs;

// 12. Super Root Manual Fund Credit / Debit (Tab 5)
async function handleSuperRootAdjustBalance(e) {
  e.preventDefault();
  const userId = document.getElementById('sradj-user-id')?.value;
  const walletType = document.getElementById('sradj-wallet-type')?.value;
  const action = document.getElementById('sradj-action')?.value;
  const amount = document.getElementById('sradj-amount')?.value;
  const reason = document.getElementById('sradj-reason')?.value || 'Super Root balance adjustment';

  const btn = document.getElementById('btn-sradj-submit');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Processing...';
  }

  try {
    const res = await fetch(`${API_BASE}/admin/adjust-balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ userId, walletType, action, amount, reason })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to adjust balance');

    showToast(data.message || 'Balance updated successfully!', 'success');
    document.getElementById('sradj-amount').value = '';
    document.getElementById('sradj-reason').value = '';
    await loadSuperRootMasterDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Execute Balance Adjustment';
    }
  }
}
window.handleSuperRootAdjustBalance = handleSuperRootAdjustBalance;

// 13. Execute Global ROI Closing
async function executeGlobalRoiClosing() {
  if (!confirm('Execute Global Daily ROI cycle for all branches and active investor contracts now?')) return;
  try {
    const res = await fetch(`${API_BASE}/admin/execute-daily-roi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Global ROI Cycle Executed! Processed ${data.investmentsProcessed || 0} contracts ($${parseFloat(data.totalDistributed || 0).toFixed(2)})`, 'success');
      await loadSuperRootMasterDashboard();
    } else {
      showToast(data.error || 'Failed to execute ROI cycle', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.executeGlobalRoiClosing = executeGlobalRoiClosing;

// 14. Toggle Team Admin Status (Active / Suspended)
async function toggleTeamAdminStatus(adminId) {
  try {
    const res = await fetch(`${API_BASE}/admin/team-admins/${adminId}/toggle-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      await loadSuperRootMasterDashboard();
    } else {
      showToast(data.error || 'Failed to toggle status', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.toggleTeamAdminStatus = toggleTeamAdminStatus;

// 15. Quick Password Reset Modal Handlers
function openQuickPasswordResetModal(userId, username) {
  const inpId = document.getElementById('qpr-user-id');
  const label = document.getElementById('qpr-target-label');
  const inpPass = document.getElementById('qpr-new-password');
  if (inpId) inpId.value = userId;
  if (label) label.textContent = `Reset credentials for @${username} (ID: ${userId})`;
  if (inpPass) inpPass.value = '';
  openModal('quickPasswordResetModal');
}
window.openQuickPasswordResetModal = openQuickPasswordResetModal;

async function handleQuickPasswordResetSubmit(e) {
  e.preventDefault();
  const userId = document.getElementById('qpr-user-id')?.value;
  const newPassword = document.getElementById('qpr-new-password')?.value;
  const btn = document.getElementById('btn-qpr-submit');

  if (!userId || !newPassword || newPassword.trim().length < 6) {
    showToast('Password must be at least 6 characters', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Updating...';
  }

  try {
    const res = await fetch(`${API_BASE}/admin/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ userId, newPassword: newPassword.trim() })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Password updated successfully!', 'success');
      closeModal('quickPasswordResetModal');
    } else {
      showToast(data.error || 'Failed to reset password', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Update & Enforce New Password';
    }
  }
}
window.handleQuickPasswordResetSubmit = handleQuickPasswordResetSubmit;

// 16. Quick Vault Address Modal Handlers (Super Root & Team Admins)
function openQuickVaultAddressModal(userId, username, currentAddress = '') {
  const inpId = document.getElementById('qva-user-id');
  const label = document.getElementById('qva-target-label');
  const curLabel = document.getElementById('qva-current-address');
  const inpNew = document.getElementById('qva-new-address');

  if (inpId) inpId.value = userId;
  if (label) label.textContent = `Modify Vault for @${username} (ID: ${userId})`;
  if (curLabel) curLabel.textContent = currentAddress ? currentAddress : 'None / Not configured';
  if (inpNew) inpNew.value = currentAddress || '';

  openModal('quickVaultAddressModal');
}
window.openQuickVaultAddressModal = openQuickVaultAddressModal;

async function pasteToVaultInput(elementId) {
  try {
    const text = await navigator.clipboard.readText();
    const el = document.getElementById(elementId);
    if (el && text) {
      el.value = text.trim();
      showToast('Address pasted from clipboard', 'info');
    }
  } catch (err) {
    showToast('Clipboard access denied. Please paste manually.', 'warning');
  }
}
window.pasteToVaultInput = pasteToVaultInput;

async function handleQuickVaultAddressSubmit(e) {
  e.preventDefault();
  const userId = document.getElementById('qva-user-id')?.value;
  const usdtAddress = document.getElementById('qva-new-address')?.value.trim();
  const btn = document.getElementById('btn-qva-submit');

  if (!userId) {
    showToast('User ID is required', 'error');
    return;
  }

  if (!usdtAddress || !/^0x[a-fA-F0-9]{40}$/.test(usdtAddress)) {
    showToast('Invalid USDT (BEP20) address. Must start with 0x and be 42 characters hex.', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Updating Vault...';
  }

  try {
    const res = await fetch(`${API_BASE}/admin/update-vault-address`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ userId: parseInt(userId, 10), usdtAddress })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Vault address updated successfully!', 'success');
      closeModal('quickVaultAddressModal');
      if (typeof loadSuperRootMasterDashboard === 'function') {
        await loadSuperRootMasterDashboard();
      }
      if (typeof loadAdminData === 'function') {
        await loadAdminData();
      }
      if (typeof loadTeamAdminsList === 'function') {
        await loadTeamAdminsList();
      }
    } else {
      showToast(data.error || 'Failed to update vault address', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Update Vault Address';
    }
  }
}
window.handleQuickVaultAddressSubmit = handleQuickVaultAddressSubmit;

// ==================== TABS HORIZONTAL SLIDER CONTROLS ====================

function slideTabTrack(containerId, distance) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.scrollBy({ left: distance, behavior: 'smooth' });
  setTimeout(() => updateTabSlideArrowStates(containerId), 250);
}
window.slideTabTrack = slideTabTrack;

function updateTabSlideArrowStates(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const isAtStart = container.scrollLeft <= 8;
  const isAtEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 8;

  const prevBtn = container.parentElement?.querySelector('.tab-slide-prev');
  const nextBtn = container.parentElement?.querySelector('.tab-slide-next');

  if (prevBtn) {
    if (isAtStart) prevBtn.classList.add('is-disabled');
    else prevBtn.classList.remove('is-disabled');
  }

  if (nextBtn) {
    if (isAtEnd) nextBtn.classList.add('is-disabled');
    else nextBtn.classList.remove('is-disabled');
  }
}
window.updateTabSlideArrowStates = updateTabSlideArrowStates;

function initTabSliderControls(containerId) {
  const container = document.getElementById(containerId);
  if (!container || container._sliderInitDone) return;
  container._sliderInitDone = true;

  // 1. Mouse wheel horizontal scrolling
  container.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      container.scrollLeft += e.deltaY;
      updateTabSlideArrowStates(containerId);
    }
  }, { passive: false });

  // 2. Drag-to-scroll with mouse
  let isDown = false;
  let startX = 0;
  let scrollLeft = 0;
  let moved = false;

  container.addEventListener('mousedown', (e) => {
    isDown = true;
    moved = false;
    startX = e.pageX - container.offsetLeft;
    scrollLeft = container.scrollLeft;
    container.classList.add('is-dragging');
  });

  window.addEventListener('mouseup', () => {
    if (!isDown) return;
    isDown = false;
    container.classList.remove('is-dragging');
    updateTabSlideArrowStates(containerId);
  });

  container.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - container.offsetLeft;
    const walk = (x - startX) * 1.5;
    if (Math.abs(walk) > 4) moved = true;
    container.scrollLeft = scrollLeft - walk;
    updateTabSlideArrowStates(containerId);
  });

  // Prevent clicking tab if it was dragged
  container.addEventListener('click', (e) => {
    if (moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // Update arrow states on scroll
  container.addEventListener('scroll', () => {
    updateTabSlideArrowStates(containerId);
  }, { passive: true });

  // Initial update
  setTimeout(() => updateTabSlideArrowStates(containerId), 250);
}
window.initTabSliderControls = initTabSliderControls;

