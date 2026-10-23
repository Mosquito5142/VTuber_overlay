export function connectSocket({ role, onMessage, onOpen = () => {}, onClose = () => {}, retryMs = 2000 }) {
  let ws = null;
  let closed = false;
  let timer = null;

  function open() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}/ws`);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'hello', role }));
      onOpen();
    });
    ws.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      onMessage(message);
    });
    ws.addEventListener('close', () => {
      onClose();
      if (!closed) timer = setTimeout(open, retryMs);
    });
  }

  open();
  return {
    send(message) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    },
    close() {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
