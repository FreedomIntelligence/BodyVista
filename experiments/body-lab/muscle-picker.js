// Search text is transient. Only choosing an option changes the muscle used by the chart.
export function createMusclePicker({input, list, onSelect}) {
  let options = [];
  let selected = null;
  let matches = [];
  let active = -1;
  let emptyLabel = "";
  let noMatchLabel = "";

  function showSelection() {
    input.value = selected?.label || (options.length ? "" : emptyLabel);
  }

  function close() {
    if (list.hidden) return;
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    matches = [];
    active = -1;
    showSelection();
  }

  function highlight(index) {
    list.children[active]?.classList.remove("is-active");
    active = index;
    const row = list.children[index];
    if (!row) {
      input.removeAttribute("aria-activedescendant");
      return;
    }
    row.classList.add("is-active");
    input.setAttribute("aria-activedescendant", row.id);
    const bounds = list.getBoundingClientRect();
    const item = row.getBoundingClientRect();
    if (item.top < bounds.top) list.scrollTop += item.top - bounds.top;
    if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
  }

  function filter() {
    const query = input.value.trim().toLowerCase();
    matches = query ? options.filter(option => option.search.includes(query)) : options;
    const rows = document.createDocumentFragment();
    for (const [index, option] of matches.entries()) {
      const row = document.createElement("li");
      row.id = list.id + "-" + index;
      row.dataset.index = String(index);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(option === selected));
      row.textContent = option.label;
      if (option.title) row.title = option.title;
      rows.append(row);
    }
    if (!matches.length) {
      const row = document.createElement("li");
      row.setAttribute("role", "option");
      row.setAttribute("aria-disabled", "true");
      row.textContent = noMatchLabel;
      rows.append(row);
    }
    list.replaceChildren(rows);
    list.scrollTop = 0;
    const initial = query ? 0 : matches.indexOf(selected);
    highlight(matches.length ? Math.max(0, initial) : -1);
  }

  function open() {
    if (!list.hidden || !options.length) return;
    input.value = "";
    input.setAttribute("aria-expanded", "true");
    list.hidden = false;
    filter();
  }

  function choose(index) {
    if (!matches[index]) return;
    selected = matches[index];
    close();
    onSelect(selected.value);
  }

  input.addEventListener("focus", open);
  input.addEventListener("click", open);
  input.addEventListener("beforeinput", open);
  input.addEventListener("input", filter);
  input.addEventListener("blur", close);
  input.addEventListener("keydown", event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (list.hidden) {
        open();
      } else if (matches.length) {
        const step = event.key === "ArrowDown" ? 1 : -1;
        highlight(Math.max(0, Math.min(matches.length - 1, active + step)));
      }
    } else if (!list.hidden && event.key === "Enter") {
      event.preventDefault();
      choose(active);
    } else if (!list.hidden && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      close();
    }
  });
  // Keep focus in the input until click commits the choice, including touch taps.
  list.addEventListener("pointerdown", event => {
    if (event.target.closest("[role=option]")) event.preventDefault();
  });
  list.addEventListener("click", event => {
    const row = event.target.closest("[data-index]");
    if (row) choose(Number(row.dataset.index));
  });

  return {
    get value() { return selected?.value || ""; },
    get sourceLabel() { return selected?.sourceLabel || selected?.label || ""; },
    setOptions(items, selectedValue, empty, noMatch) {
      options = items.map(item => ({
        ...item,
        search: [item.value, item.label, item.sourceLabel].filter(Boolean).join(" ").toLowerCase(),
      }));
      emptyLabel = empty;
      noMatchLabel = noMatch;
      selected = options.find(option => option.value === selectedValue);
      input.disabled = !options.length;
      if (!options.length) close();
      if (list.hidden) showSelection();
      else filter();
    },
    setValue(value) {
      selected = options.find(option => option.value === value);
      close();
      showSelection();
    },
  };
}
