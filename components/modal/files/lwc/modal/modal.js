import { LightningElement, api } from 'lwc';
import closeTitle from '@salesforce/label/c.Modal_CloseTitle';
import defaultCancel from '@salesforce/label/c.Modal_DefaultCancel';

export default class Modal extends LightningElement {
  @api isOpen = false;
  @api title = '';
  @api tagline = '';
  @api size = 'medium'; // small | medium | large | full
  @api hideCloseButton = false;
  @api hideHeader = false;
  @api hideFooter = false;

  labels = {
    closeTitle,
    defaultCancel
  };

  _uniqueId = Math.random().toString(36).substring(2, 9);
  _keydownHandler = null;

  connectedCallback() {
    this._keydownHandler = this.handleKeyDown.bind(this);
    window.addEventListener('keydown', this._keydownHandler);
  }

  disconnectedCallback() {
    if (this._keydownHandler) {
      window.removeEventListener('keydown', this._keydownHandler);
    }
  }

  get headerTitleId() {
    return `modal-heading-${this._uniqueId}`;
  }

  get modalContentId() {
    return `modal-content-${this._uniqueId}`;
  }

  get closeButtonTitle() {
    return this.labels.closeTitle || 'Close';
  }

  get cancelButtonLabel() {
    return this.labels.defaultCancel || 'Cancel';
  }

  get computedModalClass() {
    const classes = ['slds-modal', 'slds-fade-in-open'];
    if (this.size === 'small') classes.push('slds-modal_small');
    else if (this.size === 'large') classes.push('slds-modal_large');
    else if (this.size === 'full') classes.push('slds-modal_full');
    else classes.push('slds-modal_medium');
    return classes.join(' ');
  }

  get computedBackdropClass() {
    return 'slds-backdrop slds-backdrop_open';
  }

  get computedHeaderClass() {
    const classes = ['slds-modal__header'];
    if (!this.title && !this.tagline) {
      classes.push('slds-modal__header_empty');
    }
    return classes.join(' ');
  }

  handleKeyDown(event) {
    if (this.isOpen && event.key === 'Escape') {
      event.stopPropagation();
      this.handleClose();
    }
  }

  handleClose() {
    this.dispatchEvent(new CustomEvent('close'));
  }
}
