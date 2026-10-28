@IsTest
private class DataTableControllerTest {
    @IsTest
    static void returnsRecords() {
        insert new Account(Name = 'Acme');
        List<SObject> rows = DataTableController.getRecords('Account', new List<String>{ 'Id', 'Name' }, 10);
        Assert.areEqual(1, rows.size());
    }

    @IsTest
    static void rejectsUnknownObject() {
        try {
            DataTableController.getRecords('Nope__c', new List<String>{ 'Id' }, 10);
            Assert.fail('Expected exception');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e);
        }
    }
}
