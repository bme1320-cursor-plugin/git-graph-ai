interface DropdownOption {
	readonly name: string;
	readonly value: string;
	readonly hint?: string;
}

/**
 * Implements the dropdown inputs used in the Git Graph View's top control bar.
 */
class Dropdown {
	private readonly showInfo: boolean;
	private readonly multipleAllowed: boolean;
	private readonly changeCallback: (values: string[]) => void;

	private options: ReadonlyArray<DropdownOption> = [];
	private optionsSelected: boolean[] = [];
	private lastSelected: number = 0; // Only used when multipleAllowed === false
	private dropdownVisible: boolean = false;
	private lastClicked: number = 0;
	private doubleClickTimeout: NodeJS.Timer | null = null;

	private readonly elem: HTMLElement;
	private readonly currentValueElem: HTMLDivElement;
	private readonly menuElem: HTMLDivElement;
	private readonly optionsElem: HTMLDivElement;
	private readonly noResultsElem: HTMLDivElement;
	private readonly filterInput: HTMLInputElement;

	/**
	 * Constructs a Dropdown instance.
	 * @param id The ID of the HTML Element that the dropdown should be rendered in.
	 * @param showInfo Should an information icon be shown on the right of each dropdown item.
	 * @param multipleAllowed Can multiple items be selected.
	 * @param dropdownType The type of content the dropdown is being used for.
	 * @param changeCallback A callback to be invoked when the selected item(s) of the dropdown changes.
	 * @returns The Dropdown instance.
	 */
	constructor(id: string, showInfo: boolean, multipleAllowed: boolean, dropdownType: string, changeCallback: (values: string[]) => void) {
		this.showInfo = showInfo;
		this.multipleAllowed = multipleAllowed;
		this.changeCallback = changeCallback;
		this.elem = document.getElementById(id)!;

		this.menuElem = document.createElement('div');
		this.menuElem.className = 'dropdownMenu';

		let filter = this.menuElem.appendChild(document.createElement('div'));
		filter.className = 'dropdownFilter';

		this.filterInput = filter.appendChild(document.createElement('input'));
		this.filterInput.className = 'dropdownFilterInput';
		this.filterInput.placeholder = 'Filter ' + dropdownType + '...';

		this.optionsElem = this.menuElem.appendChild(document.createElement('div'));
		this.optionsElem.className = 'dropdownOptions';

		this.noResultsElem = this.menuElem.appendChild(document.createElement('div'));
		this.noResultsElem.className = 'dropdownNoResults';
		this.noResultsElem.innerHTML = 'No results found.';

		this.currentValueElem = this.elem.appendChild(document.createElement('div'));
		this.currentValueElem.className = 'dropdownCurrentValue';

		alterClass(this.elem, 'multi', multipleAllowed);
		this.elem.appendChild(this.menuElem);

		document.addEventListener('click', (e) => {
			if (!e.target) return;
			if (e.target === this.currentValueElem) {
				this.dropdownVisible = !this.dropdownVisible;
				if (this.dropdownVisible) {
					this.filterInput.value = '';
					this.filter();
				}
				this.elem.classList.toggle('dropdownOpen');
				if (this.dropdownVisible) this.filterInput.focus();
			} else if (this.dropdownVisible) {
				if ((<HTMLElement>e.target).closest('.dropdown') !== this.elem) {
					this.close();
				} else {
					const option = <HTMLElement | null>(<HTMLElement>e.target).closest('.dropdownOption');
					if (option !== null && option.parentNode === this.optionsElem && typeof option.dataset.id !== 'undefined') {
						this.onOptionClick(parseInt(option.dataset.id!));
					}
				}
			}
		}, true);
		document.addEventListener('contextmenu', () => this.close(), true);
		this.filterInput.addEventListener('keyup', () => this.filter());
	}

	/**
	 * Set the options that should be displayed in the dropdown.
	 * @param options An array of the options to display in the dropdown.
	 * @param optionsSelected An array of the selected options in the dropdown.
	 */
	public setOptions(options: ReadonlyArray<DropdownOption>, optionsSelected: string[]) {
		this.options = options;
		this.optionsSelected = [];
		let selectedOption = -1, isSelected;
		for (let i = 0; i < options.length; i++) {
			isSelected = optionsSelected.includes(options[i].value);
			this.optionsSelected[i] = isSelected;
			if (isSelected) {
				selectedOption = i;
			}
		}
		if (selectedOption === -1) {
			selectedOption = 0;
			this.optionsSelected[selectedOption] = true;
		}
		this.lastSelected = selectedOption;
		if (this.dropdownVisible && options.length <= 1) this.close();
		this.render();
		this.clearDoubleClickTimeout();
	}

	/**
	 * Is a value selected in the dropdown (respecting "Show All")
	 * @param value The value to check.
	 * @returns TRUE => The value is selected, FALSE => The value is not selected.
	 */
	public isSelected(value: string) {
		if (this.options.length > 0) {
			if (this.multipleAllowed && this.optionsSelected[0]) {
				// Multiple options can be selected, and "Show All" is selected.
				return true;
			}
			const optionIndex = this.options.findIndex((option) => option.value === value);
			if (optionIndex > -1 && this.optionsSelected[optionIndex]) {
				// The specific option is selected
				return true;
			}
		}
		return false;
	}

	/**
	 * Select a specific value in the dropdown.
	 * @param value The value to select.
	 */
	public selectOption(value: string) {
		const optionIndex = this.options.findIndex((option) => value === option.value);
		if (this.multipleAllowed && optionIndex > -1 && !this.optionsSelected[0] && !this.optionsSelected[optionIndex]) {
			// Select the option with the specified value
			this.optionsSelected[optionIndex] = true;

			// A change has occurred, re-render the dropdown options
			const menuScroll = this.menuElem.scrollTop;
			this.render();
			if (this.dropdownVisible) {
				this.menuElem.scroll(0, menuScroll);
			}
			this.changeCallback(this.getSelectedOptions(false));
		}
	}

	/**
	 * Unselect a specific value in the dropdown.
	 * @param value The value to unselect.
	 */
	public unselectOption(value: string) {
		const optionIndex = this.options.findIndex((option) => value === option.value);
		if (this.multipleAllowed && optionIndex > -1 && (this.optionsSelected[0] || this.optionsSelected[optionIndex])) {
			if (this.optionsSelected[0]) {
				// Show All is currently selected, so unselect it, and select all branch options
				this.optionsSelected[0] = false;
				for (let i = 1; i < this.optionsSelected.length; i++) {
					this.optionsSelected[i] = true;
				}
			}

			// Unselect the option with the specified value
			this.optionsSelected[optionIndex] = false;
			if (this.optionsSelected.every(selected => !selected)) {
				// All items have been unselected, select "Show All"
				this.optionsSelected[0] = true;
			}

			// A change has occurred, re-render the dropdown options
			const menuScroll = this.menuElem.scrollTop;
			this.render();
			if (this.dropdownVisible) {
				this.menuElem.scroll(0, menuScroll);
			}
			this.changeCallback(this.getSelectedOptions(false));
		}
	}

	/**
	 * Refresh the rendered dropdown to apply style changes.
	 */
	public refresh() {
		if (this.options.length > 0) this.render();
	}

	/**
	 * Is the dropdown currently open (i.e. is the list of options visible).
	 * @returns TRUE => The dropdown is open, FALSE => The dropdown is not open
	 */
	public isOpen() {
		return this.dropdownVisible;
	}

	/**
	 * Close the dropdown.
	 */
	public close() {
		this.elem.classList.remove('dropdownOpen');
		this.dropdownVisible = false;
		this.clearDoubleClickTimeout();
	}

	/**
	 * Render the dropdown.
	 */
	private render() {
		this.elem.classList.add('loaded');

		const curValueText = formatCommaSeparatedList(this.getSelectedOptions(true));
		this.currentValueElem.title = curValueText;
		this.currentValueElem.innerHTML = escapeHtml(curValueText);

		let html = '';
		for (let i = 0; i < this.options.length; i++) {
			const escapedName = escapeHtml(this.options[i].name);
			html += '<div class="dropdownOption' + (this.optionsSelected[i] ? ' ' + CLASS_SELECTED : '') + '" data-id="' + i + '" title="' + escapedName + '">' +
				(this.multipleAllowed && this.optionsSelected[i] ? '<div class="dropdownOptionMultiSelected">' + SVG_ICONS.check + '</div>' : '') +
				escapedName + (typeof this.options[i].hint === 'string' && this.options[i].hint !== '' ? '<span class="dropdownOptionHint">' + escapeHtml(this.options[i].hint!) + '</span>' : '') +
				(this.showInfo ? '<div class="dropdownOptionInfo" title="' + escapeHtml(this.options[i].value) + '">' + SVG_ICONS.info + '</div>' : '') +
				'</div>';
		}
		this.optionsElem.className = 'dropdownOptions' + (this.showInfo ? ' showInfo' : '');
		this.optionsElem.innerHTML = html;
		this.filterInput.style.display = 'none';
		this.noResultsElem.style.display = 'none';
		this.menuElem.style.cssText = 'opacity:0; display:block;';
		// Width must be at least 138px for the filter element.
		// Don't need to add 12px if showing (info icons or multi checkboxes) and the scrollbar isn't needed. The scrollbar isn't needed if: menuElem height + filter input (25px) < 297px
		const menuElemRect = this.menuElem.getBoundingClientRect();
		this.currentValueElem.style.width = Math.max(Math.ceil(menuElemRect.width) + ((this.showInfo || this.multipleAllowed) && menuElemRect.height < 272 ? 0 : 12), 138) + 'px';
		this.menuElem.style.cssText = 'right:0; overflow-y:auto; max-height:297px;'; // Max height for the dropdown is [filter (31px) + 9.5 * dropdown item (28px) = 297px]
		if (this.dropdownVisible) this.filter();
	}

	/**
	 * Filter the options displayed in the dropdown list, based on the filter criteria specified by the user.
	 */
	private filter() {
		let val = this.filterInput.value.toLowerCase(), match, matches = false;
		for (let i = 0; i < this.options.length; i++) {
			match = this.options[i].name.toLowerCase().indexOf(val) > -1;
			(<HTMLElement>this.optionsElem.children[i]).style.display = match ? 'block' : 'none';
			if (match) matches = true;
		}
		this.filterInput.style.display = 'block';
		this.noResultsElem.style.display = matches ? 'none' : 'block';
	}

	/**
	 * Get an array of the selected dropdown options.
	 * @param names TRUE => Return the names of the selected options, FALSE => Return the values of the selected options.
	 * @returns The array of the selected options.
	 */
	private getSelectedOptions(names: boolean) {
		let selected = [];
		if (this.multipleAllowed && this.optionsSelected[0]) {
			// Note: Show All is always the first option (0 index) when multiple selected items are allowed
			return [names ? this.options[0].name : this.options[0].value];
		}
		for (let i = 0; i < this.options.length; i++) {
			if (this.optionsSelected[i]) selected.push(names ? this.options[i].name : this.options[i].value);
		}
		return selected;
	}

	/**
	 * Select a dropdown option.
	 * @param option The index of the option to select.
	 */
	private onOptionClick(option: number) {
		// Note: Show All is always the first option (0 index) when multiple selected items are allowed
		let change = false;
		let doubleClick = this.doubleClickTimeout !== null && this.lastClicked === option;
		if (this.doubleClickTimeout !== null) this.clearDoubleClickTimeout();

		if (doubleClick) {
			// Double click
			if (this.multipleAllowed && option === 0) {
				for (let i = 1; i < this.optionsSelected.length; i++) {
					this.optionsSelected[i] = !this.optionsSelected[i];
				}
				change = true;
			}
		} else {
			// Single Click
			if (this.multipleAllowed) {
				// Multiple dropdown options can be selected
				if (option === 0) {
					// Show All was selected
					if (!this.optionsSelected[0]) {
						this.optionsSelected[0] = true;
						for (let i = 1; i < this.optionsSelected.length; i++) {
							this.optionsSelected[i] = false;
						}
						change = true;
					}
				} else {
					if (this.optionsSelected[0]) {
						// Deselect "Show All" if it is enabled
						this.optionsSelected[0] = false;
					}

					this.optionsSelected[option] = !this.optionsSelected[option];

					if (this.optionsSelected.every(selected => !selected)) {
						// All items have been unselected, select "Show All"
						this.optionsSelected[0] = true;
					}
					change = true;
				}
			} else {
				// Only a single dropdown option can be selected
				this.close();
				if (this.lastSelected !== option) {
					this.optionsSelected[this.lastSelected] = false;
					this.optionsSelected[option] = true;
					this.lastSelected = option;
					change = true;
				}
			}

			if (change) {
				// If a change has occurred, trigger the callback
				this.changeCallback(this.getSelectedOptions(false));
			}
		}

		if (change) {
			// If a change has occurred, re-render the dropdown elements
			let menuScroll = this.menuElem.scrollTop;
			this.render();
			if (this.dropdownVisible) this.menuElem.scroll(0, menuScroll);
		}

		this.lastClicked = option;
		this.doubleClickTimeout = setTimeout(() => {
			this.clearDoubleClickTimeout();
		}, 500);
	}

	/**
	 * Clear the timeout used to detect double clicks.
	 */
	private clearDoubleClickTimeout() {
		if (this.doubleClickTimeout !== null) {
			// Cast timer to any to resolve type mismatch
			clearTimeout(this.doubleClickTimeout as any);
			this.doubleClickTimeout = null;
		}
	}
}
