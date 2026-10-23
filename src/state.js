export function createState({ setTimeout: setTimer = globalThis.setTimeout, clearTimeout: clearTimer = globalThis.clearTimeout } = {}) {
  let talking = false;
  let expression = 'default';
  let avatar = null;
  let expressions = {};
  let revision = 0;
  let timer = null;
  const listeners = new Set();

  const snapshot = () => ({ talking, expression, avatar, revision });

  function emit() {
    revision += 1;
    const current = snapshot();
    for (const listener of listeners) listener(current);
  }

  function cancelTimer() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function setExpression(name) {
    cancelTimer();
    if (expression !== name) {
      expression = name;
      emit();
    }
  }

  return {
    snapshot,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTalking(value) {
      const next = Boolean(value);
      if (next !== talking) {
        talking = next;
        emit();
      }
    },
    setAvatar(name, config) {
      cancelTimer();
      avatar = name;
      expressions = config?.expressions ?? {};
      expression = 'default';
      emit();
    },
    updateExpressions(config) {
      expressions = config?.expressions ?? {};
      if (expression !== 'default' && !expressions[expression]) setExpression('default');
    },
    triggerExpression(name) {
      if (name === 'default') {
        setExpression('default');
        return true;
      }
      const definition = expressions[name];
      if (!definition) return false;
      if (definition.mode === 'toggle') {
        setExpression(expression === name ? 'default' : name);
        return true;
      }
      setExpression(name);
      timer = setTimer(() => {
        timer = null;
        setExpression('default');
      }, definition.seconds * 1000);
      return true;
    },
    dispose() {
      cancelTimer();
      listeners.clear();
    },
  };
}
