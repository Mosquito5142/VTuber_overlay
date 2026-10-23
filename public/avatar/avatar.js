import { createRenderer } from '/shared/renderer.js';
import { connectSocket } from '/shared/socket.js';

const renderer = createRenderer(document.getElementById('stage'));
let last = { talking: false, expression: 'default' };

connectSocket({
  role: 'avatar',
  onMessage(message) {
    if (message.type === 'config') renderer.setModel(message);
    else if (message.type === 'state') {
      last = message;
      renderer.setState(message);
    } else if (message.type === 'level') renderer.setLevel(message.level);
    else if (message.type === 'play') renderer.play(message.action);
  },
  onClose() {
    // server หลุด: ค้างภาพล่าสุดไว้แต่หุบปาก ไม่ให้ปากค้างอ้าบนสตรีม
    renderer.setLevel(0);
    renderer.setState({ ...last, talking: false });
  },
});
