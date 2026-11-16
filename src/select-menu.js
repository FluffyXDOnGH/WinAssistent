(() => {
  const controls = new WeakMap();
  let active = null;

  function close(restoreFocus = false) {
    if (!active) return;
    const { button, menu } = active;
    menu.remove();
    button.setAttribute('aria-expanded', 'false');
    active = null;
    if (restoreFocus) button.focus();
  }

  function selectedOption(select) {
    return select.selectedOptions[0] || select.options[0];
  }

  function refresh(select) {
    const control = controls.get(select);
    if (!control) return;
    const option = selectedOption(select);
    control.label.textContent = option?.textContent || '';
    control.button.disabled = select.disabled || !select.options.length;
    control.button.setAttribute('aria-label', select.getAttribute('aria-label') || '');
    if (active?.select === select) buildOptions(active);
  }

  function choose(entry, index) {
    const option = entry.select.options[index];
    if (!option || option.disabled) return;
    const changed = entry.select.selectedIndex !== index;
    entry.select.selectedIndex = index;
    refresh(entry.select);
    close(true);
    if (changed) entry.select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function mark(entry, index) {
    entry.focused = index;
    [...entry.menu.children].forEach((item, itemIndex) => {
      item.classList.toggle('focused', itemIndex === index);
    });
    entry.menu.children[index]?.scrollIntoView({ block: 'nearest' });
  }

  function buildOptions(entry) {
    entry.menu.replaceChildren();
    [...entry.select.options].forEach((option, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'select-option';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === entry.select.selectedIndex));
      item.disabled = option.disabled;
      item.textContent = option.textContent;
      item.addEventListener('pointerenter', () => mark(entry, index));
      item.addEventListener('click', () => choose(entry, index));
      entry.menu.append(item);
    });
    mark(entry, Math.max(0, entry.select.selectedIndex));
  }

  function open(select, button) {
    if (active?.select === select) {
      close();
      return;
    }
    close();
    const menu = document.createElement('div');
    menu.className = 'select-menu';
    menu.setAttribute('role', 'listbox');
    const entry = { select, button, menu, focused: select.selectedIndex };
    active = entry;
    buildOptions(entry);
    document.body.append(menu);
    const bounds = button.getBoundingClientRect();
    const roomBelow = window.innerHeight - bounds.bottom - 8;
    const roomAbove = bounds.top - 8;
    const above = roomBelow < 150 && roomAbove > roomBelow;
    const height = Math.min(menu.scrollHeight, 250, Math.max(100, above ? roomAbove : roomBelow));
    menu.style.maxHeight = `${height}px`;
    menu.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - bounds.width - 8))}px`;
    menu.style.width = `${bounds.width}px`;
    menu.style.top = `${above ? Math.max(8, bounds.top - height - 5) : bounds.bottom + 5}px`;
    button.setAttribute('aria-expanded', 'true');
  }

  function attach(select) {
    if (controls.has(select)) return;
    const wrapper = document.createElement('span');
    wrapper.className = 'select-control';
    select.parentNode.insertBefore(wrapper, select);
    wrapper.append(select);
    select.hidden = true;
    select.tabIndex = -1;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'select-trigger';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span');
    const chevron = document.createElement('i');
    chevron.className = 'bi bi-chevron-down';
    chevron.setAttribute('aria-hidden', 'true');
    button.append(label, chevron);
    wrapper.append(button);
    controls.set(select, { button, label });
    button.addEventListener('click', () => open(select, button));
    button.addEventListener('keydown', (event) => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        if (!active || active.select !== select) open(select, button);
        else if (event.key === 'Enter' || event.key === ' ') choose(active, active.focused);
        else {
          const step = event.key === 'ArrowDown' ? 1 : -1;
          let index = active.focused;
          do index = (index + step + select.options.length) % select.options.length;
          while (select.options[index].disabled && index !== active.focused);
          mark(active, index);
        }
      } else if (event.key === 'Escape' && active?.select === select) {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    });
    select.addEventListener('change', () => refresh(select));
    new MutationObserver(() => refresh(select)).observe(select, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-label'],
    });
    refresh(select);
  }

  function scan() {
    if (active && !active.select.isConnected) close();
    document.querySelectorAll('select').forEach(attach);
  }

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (active && !active.menu.contains(event.target) && !active.button.contains(event.target))
        close();
    },
    true,
  );
  document.addEventListener(
    'scroll',
    (event) => {
      if (active && !active.menu.contains(event.target)) close();
    },
    true,
  );
  window.addEventListener('resize', () => close());
  window.refreshSelectMenus = () => document.querySelectorAll('select').forEach(refresh);
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();
