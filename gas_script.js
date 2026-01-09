function doGet() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet(); // Or specify sheet name: ss.getSheetByName('Sheet1');

    // Get all data
    const rows = sheet.getDataRange().getValues();

    // Columns:
    // A (0): Index
    // B (1): Word
    // C (2): POS 1
    // D (3): Meaning 1
    // E (4): Question 1 (Example)
    // F (5): Answer 1 (Example Translated)

    const data = [];

    // Start from row 1 (skipping header row 0)
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];

        // Skip empty rows if Word is missing
        if (!row[1]) continue;

        data.push({
            word: row[1],
            pos: row[2], // e.g. 'noun', 'verb'
            meaning: row[3],
            example: row[4],
            example_ja: row[5] // The Japanese translation of the example
        });
    }

    // Return JSON
    return ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}
