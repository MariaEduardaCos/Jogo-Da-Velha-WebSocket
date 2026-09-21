const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const guestBtn = document.getElementById('guestBtn');

function show(mode) {
  const login = mode === 'login';
  tabLogin.classList.toggle('active', login);
  tabRegister.classList.toggle('active', !login);
  loginForm.classList.toggle('hidden', !login);
  registerForm.classList.toggle('hidden', login);
}

tabLogin.addEventListener('click', () => show('login'));
tabRegister.addEventListener('click', () => show('register'));

async function submitAuth(url, payload = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Falha na autenticação.');
  window.ws3.saveAuth(data);
  window.ws3.clearSession();
  location.replace('/tela1-lobby.html');
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await submitAuth('/api/auth/login', {
      email: document.getElementById('loginEmail').value.trim(),
      password: document.getElementById('loginPassword').value
    });
  } catch (error) { window.ws3.notify(error.message, 'error'); }
});

registerForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await submitAuth('/api/auth/register', {
      nickname: document.getElementById('registerNickname').value.trim(),
      email: document.getElementById('registerEmail').value.trim(),
      password: document.getElementById('registerPassword').value
    });
  } catch (error) { window.ws3.notify(error.message, 'error'); }
});

guestBtn.addEventListener('click', async () => {
  guestBtn.disabled = true;
  try {
    await submitAuth('/api/auth/guest');
  } catch (error) {
    guestBtn.disabled = false;
    window.ws3.notify(error.message, 'error');
  }
});

(function init() {
  // A página de login funciona como seletor de conta desta aba.
  // sessionStorage é isolado por aba; limpar aqui não desloga nenhuma outra aba.
  // Isso também evita que uma aba duplicada herde a conta da aba original.
  window.ws3.clearAuth();
})();
