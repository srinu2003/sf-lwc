public with sharing class DataTableController {
    @AuraEnabled(cacheable=true)
    public static List<SObject> getRecords(String objectApiName, List<String> fields, Integer limitCount) {
        Schema.SObjectType sot = Schema.getGlobalDescribe().get(objectApiName);
        if (sot == null || fields == null) {
            throw new AuraHandledException(System.Label.DataTable_InvalidObject);
        }
        Map<String, Schema.SObjectField> fieldMap = sot.getDescribe().fields.getMap();
        List<String> safeFields = new List<String>();
        for (String f : fields) {
            if (fieldMap.containsKey(f.toLowerCase())) {
                safeFields.add(f);
            }
        }
        if (safeFields.isEmpty()) {
            throw new AuraHandledException(System.Label.DataTable_InvalidObject);
        }
        Integer lim = Math.min(limitCount == null ? 50 : limitCount, 200);
        String soql = 'SELECT ' + String.join(safeFields, ', ') +
            ' FROM ' + sot.getDescribe().getName() +
            ' WITH USER_MODE LIMIT ' + lim;
        return Database.query(soql);
    }
}
