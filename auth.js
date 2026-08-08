document.addEventListener('DOMContentLoaded', function () {
  const currentPage = window.location.pathname.split('/').pop();
  const storedUser = localStorage.getItem('pomuUser');

  if (currentPage === 'dashboard.html' && !storedUser) {
    window.location.href = 'login.html';
  }

  if (currentPage === 'login.html' && storedUser) {
    window.location.href = 'dashboard.html';
  }
});
