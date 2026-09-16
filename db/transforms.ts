/**
 * Pure, side-effect-free helpers for turning the seed CSV into database
 * records. Kept separate from any database access so they can be unit tested
 * in isolation and reused by the seed script.
 */

export interface GameCsvRow {
    title: string;
    category: string;
    publisher: string;
    description: string;
}

const CROWDFUNDING_BLURB = ' Support this game through our crowdfunding platform!';

/**
 * Minimal RFC-4180-style CSV parser supporting quoted fields, escaped quotes
 * (""), and newlines inside quoted values. Returns rows keyed by header name.
 *
 * @param content - CSV document to parse.
 * @returns Parsed records keyed by their header names.
 */
export function parseCsv(content: string): Record<string, string>[] {
    const records: string[][] = [];
    let field = '';
    let record: string[] = [];
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
        const char = content[i];

        if (inQuotes) {
            if (char === '"') {
                if (content[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            record.push(field);
            field = '';
        } else if (char === '\n' || char === '\r') {
            // Handle CRLF by skipping the paired \n.
            if (char === '\r' && content[i + 1] === '\n') {
                i++;
            }
            record.push(field);
            field = '';
            if (record.some((value) => value.length > 0) || record.length > 1) {
                records.push(record);
            }
            record = [];
        } else {
            field += char;
        }
    }

    // Flush trailing field/record (file without trailing newline).
    if (field.length > 0 || record.length > 0) {
        record.push(field);
        if (record.some((value) => value.length > 0)) {
            records.push(record);
        }
    }

    if (records.length === 0) {
        return [];
    }

    const [header, ...rows] = records;
    return rows.map((row) => {
        const entry: Record<string, string> = {};
        header.forEach((key, index) => {
            entry[key] = row[index] ?? '';
        });
        return entry;
    });
}

/**
 * Parse the games seed CSV into typed rows.
 *
 * @param content - Games CSV document to parse.
 * @returns Valid game rows with trimmed fields.
 */
export function parseGamesCsv(content: string): GameCsvRow[] {
    return parseCsv(content)
        .filter((row) => (row.Title ?? '').trim().length > 0)
        .map((row) => ({
            title: row.Title.trim(),
            category: row.Category.trim(),
            publisher: row.Publisher.trim(),
            description: row.Description.trim(),
        }));
}

/**
 * Build the generated category description used during seeding.
 *
 * @param name - Category name.
 * @returns Stable category description.
 */
export function categoryDescription(name: string): string {
    return `Collection of ${name} games available for crowdfunding`;
}

/**
 * Build the generated publisher description used during seeding.
 *
 * @param name - Publisher name.
 * @returns Stable publisher description.
 */
export function publisherDescription(name: string): string {
    return `${name} is a game publisher seeking funding for exciting new titles`;
}

/**
 * Append the platform's standard crowdfunding call to a game description.
 *
 * @param rawDescription - Description from the source CSV.
 * @returns Enriched game description.
 */
export function gameDescription(rawDescription: string): string {
    return rawDescription + CROWDFUNDING_BLURB;
}

/**
 * Return distinct category names in first-seen order.
 *
 * @param rows - Parsed game rows.
 * @returns Unique category names.
 */
export function uniqueCategories(rows: GameCsvRow[]): string[] {
    return [...new Set(rows.map((row) => row.category))];
}

/**
 * Return distinct publisher names in first-seen order.
 *
 * @param rows - Parsed game rows.
 * @returns Unique publisher names.
 */
export function uniquePublishers(rows: GameCsvRow[]): string[] {
    return [...new Set(rows.map((row) => row.publisher))];
}

/**
 * Deterministically derive a star rating in [3.0, 5.0] (one decimal place)
 * from the game title. Using a stable hash instead of Math.random keeps
 * static builds reproducible.
 *
 * @param title - Game title used as the stable seed.
 * @returns A deterministic rating between 3.0 and 5.0.
 */
export function ratingFromTitle(title: string): number {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
        hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
    }
    // 21 buckets -> 3.0, 3.1, ... 5.0
    const tenths = hash % 21;
    return Math.round((3.0 + tenths / 10) * 10) / 10;
}
