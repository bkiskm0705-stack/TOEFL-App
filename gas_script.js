function doGet(e) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Default to 'TOEFL_Vocabulary' if no sheet param is provided
    let sheetName = 'TOEFL_Vocabulary';
    if (e && e.parameter && e.parameter.sheet) {
        sheetName = e.parameter.sheet;
    }

    let sheet = ss.getSheetByName(sheetName);

    // Fallback if sheet doesn't exist (e.g. repo typo vs spreadsheet actual name)
    if (!sheet) {
        // Try known variations just in case
        if (sheetName === 'My_Vocabulary') {
            sheet = ss.getSheetByName('My Vocab') || ss.getSheetByName('My_Vocablary');
        }
        if (!sheet && sheetName === 'TOEIC_Golden') {
            sheet = ss.getSheetByName('TOEIC Golden') || ss.getSheetByName('TOEICGolden');
        }

        // If still not found, default to first sheet
        if (!sheet) sheet = ss.getSheets()[0];
    }

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
            example_ja: row[5], // The Japanese translation of the example
            // POS 2 data (columns G-J)
            pos2: row[6] || '',
            meaning2: row[7] || '',
            example2: row[8] || '',
            example_ja2: row[9] || '',
            // POS 3 data (columns K-N)
            pos3: row[10] || '',
            meaning3: row[11] || '',
            example3: row[12] || '',
            example_ja3: row[13] || ''
        });
    }

    // Return JSON
    return ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}
