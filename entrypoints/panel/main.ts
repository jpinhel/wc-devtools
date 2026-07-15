import './wc-devtools-app';

const root = document.getElementById('app');
if (root) {
  root.innerHTML = '';
  root.appendChild(document.createElement('wc-devtools-app'));
}
