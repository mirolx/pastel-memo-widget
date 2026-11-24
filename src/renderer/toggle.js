const api = window.memoApi;
const b = document.getElementById('b');
const set = (hidden) => b.classList.toggle('off', hidden);

b.addEventListener('click', () => api.toggleClick());
b.addEventListener('contextmenu', (e) => { e.preventDefault(); api.toggleNew(); });
api.onHiddenChanged(set);
api.toggleState().then(set);
