import { LightningElement, api, wire } from 'lwc';
import getRecords from '@salesforce/apex/DataTableController.getRecords';
import NO_RECORDS from '@salesforce/label/c.DataTable_NoRecords';
import { showToast } from 'c/toastUtils';

export default class DataTable extends LightningElement {
    @api objectApiName;
    @api columns = []; // [{ label: 'Name', fieldName: 'Name' }]
    @api limitCount = 50;

    label = { NO_RECORDS };
    rows = [];

    get fieldNames() {
        return ['Id', ...this.columns.map((c) => c.fieldName)];
    }

    get isEmpty() {
        return this.rows.length === 0;
    }

    @wire(getRecords, { objectApiName: '$objectApiName', fields: '$fieldNames', limitCount: '$limitCount' })
    wiredRecords({ data, error }) {
        if (data) {
            this.rows = data;
        } else if (error) {
            this.rows = [];
            showToast(this, 'Error', error.body?.message ?? 'Unable to load records', 'error');
        }
    }
}
