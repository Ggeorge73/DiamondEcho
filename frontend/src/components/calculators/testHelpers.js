import { act } from 'react';

// Small helpers shared by the calculator tests: find a control by name, type
// into it the way a browser does, and press a button by its label.
export const helpers = (getContainer) => {
  const field = (name) => getContainer().querySelector(`[name="${name}"]`);
  const visibleButtons = () => [...getContainer().querySelectorAll('button')].filter((item) => !item.closest('[hidden]'));
  return {
    text: () => getContainer().textContent,
    field,
    type: async (name, value) => {
      const control = field(name);
      const proto = control.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setValue = Object.getOwnPropertyDescriptor(proto, 'value').set;
      await act(async () => {
        setValue.call(control, value);
        control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      });
    },
    press: async (label, within) => {
      const scope = within ? [...within.querySelectorAll('button')] : visibleButtons();
      const target = scope.find((item) => item.textContent.trim() === label || item.getAttribute('aria-label') === label);
      if (!target) throw new Error(`No button "${label}"`);
      await act(async () => { target.click(); });
    },
    group: (label) => getContainer().querySelector(`[role="group"][aria-label="${label}"]`),
  };
};
