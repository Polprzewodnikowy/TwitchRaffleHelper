interface ExtendedHTMLButtonElement extends HTMLButtonElement {
  show: (show: boolean) => void;
}

export class ControlError extends Error {}

export class Control {
  showView(view: string) {
    const views = document.getElementsByClassName("view");

    for (let div of views) {
      if (div.id === `view${view.charAt(0).toUpperCase()}${view.slice(1)}`) {
        div.classList.remove("hidden");
      } else {
        div.classList.add("hidden");
      }
    }
  }

  addButtonHandler(
    id: string,
    handler: (
      event: PointerEvent & { target: ExtendedHTMLButtonElement },
    ) => void,
  ) {
    const el = document.getElementById(id) as ExtendedHTMLButtonElement;

    if (!(el instanceof HTMLButtonElement)) {
      throw new ControlError();
    }

    el.onclick = (event) =>
      handler(event as PointerEvent & { target: ExtendedHTMLButtonElement });

    el.show = (show) => {
      if (show) {
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    };

    return el;
  }

  addInputHandler(
    id: string,
    handler: (event: InputEvent & { target: HTMLInputElement }) => void,
    init?: string | null,
  ) {
    const el = document.getElementById(id);

    if (!(el instanceof HTMLInputElement)) {
      throw new ControlError();
    }

    if (init) {
      el.value = init;
    }

    el.oninput = (event) =>
      handler(event as InputEvent & { target: HTMLInputElement });

    return el;
  }

  getDivElement(id: string) {
    const el = document.getElementById(id);

    if (!(el instanceof HTMLDivElement)) {
      throw new ControlError();
    }

    return el;
  }

  getImgElement(id: string) {
    const el = document.getElementById(id);

    if (!(el instanceof HTMLImageElement)) {
      throw new ControlError();
    }

    return el;
  }

  getSpanElement(id: string) {
    const el = document.getElementById(id);

    if (!(el instanceof HTMLSpanElement)) {
      throw new ControlError();
    }

    return el;
  }

  setListEntries(id: string, entries: { text: string; color?: string }[]) {
    const el = document.getElementById(id);

    if (!(el instanceof HTMLUListElement)) {
      throw new ControlError();
    }

    el.replaceChildren(
      ...entries.map((entry) => {
        const listItem = document.createElement("li");
        listItem.innerText = entry.text;
        if (entry.color) {
          listItem.style.color = entry.color;
        }
        return listItem;
      }),
    );
  }
}
