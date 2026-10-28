import { ShowToastEvent } from 'lightning/platformShowToastEvent';

export function showToast(component, title, message, variant = 'info') {
    component.dispatchEvent(new ShowToastEvent({ title, message, variant }));
}
