import { eq, asc } from 'drizzle-orm';
import type { Database } from './db';
import { games, categories, publishers } from '../../db/schema';
import type { Game } from '../types/game';

const gameSelection = {
    id: games.id,
    title: games.title,
    description: games.description,
    starRating: games.starRating,
    categoryId: categories.id,
    categoryName: categories.name,
    publisherId: publishers.id,
    publisherName: publishers.name,
};

type GameSelectionRow = {
    id: number;
    title: string;
    description: string;
    starRating: number | null;
    categoryId: number | null;
    categoryName: string | null;
    publisherId: number | null;
    publisherName: string | null;
};

function mapGame(row: GameSelectionRow): Game {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        starRating: row.starRating,
        category:
            row.categoryId !== null && row.categoryName !== null
                ? { id: row.categoryId, name: row.categoryName }
                : null,
        publisher:
            row.publisherId !== null && row.publisherName !== null
                ? { id: row.publisherId, name: row.publisherName }
                : null,
    };
}

function baseGamesQuery(db: Database) {
    return db
        .select(gameSelection)
        .from(games)
        .leftJoin(categories, eq(games.categoryId, categories.id))
        .leftJoin(publishers, eq(games.publisherId, publishers.id));
}

function normalizeSearchText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function hasFuzzySubsequence(query: string, value: string): boolean {
    if (query.length === 0) return true;
    if (query.length > value.length) return false;

    let queryIndex = 0;
    for (const character of value) {
        if (character === query[queryIndex]) {
            queryIndex += 1;
            if (queryIndex === query.length) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Determine whether a game matches a normalized title, metadata, or description query.
 *
 * @param game - Game to inspect.
 * @param rawQuery - User-entered search text.
 * @returns Whether the game matches the query.
 */
export function matchesGameQuery(game: Game, rawQuery: string): boolean {
    const query = normalizeSearchText(rawQuery);
    if (!query) {
        return true;
    }

    const searchText = [
        game.title,
        game.category?.name ?? '',
        game.publisher?.name ?? '',
        game.description,
    ].join(' ');
    const normalizedSearchText = normalizeSearchText(searchText);

    if (normalizedSearchText.includes(query)) {
        return true;
    }

    const queryTokens = query.split(/\s+/).filter(Boolean);
    if (queryTokens.length === 0) {
        return true;
    }

    const values = normalizedSearchText.split(/\s+/).filter(Boolean);
    if (queryTokens.every((token) => values.some((value) => value.includes(token)))) {
        return true;
    }

    return queryTokens.every((token) => values.some((value) => hasFuzzySubsequence(token, value)));
}

/**
 * Filter games using the same matching rules as the catalog search.
 *
 * @param gamesList - Games to filter.
 * @param rawQuery - User-entered search text.
 * @returns Matching games in their original order.
 */
export function filterGamesByQuery(gamesList: Game[], rawQuery: string): Game[] {
    return gamesList.filter((game) => matchesGameQuery(game, rawQuery));
}

/**
 * Filter games by selected categories and an optional publisher.
 *
 * @param gamesList - Games to filter.
 * @param selectedCategories - Category names; games match any selected category.
 * @param selectedPublisher - Publisher name, or an empty string for all publishers.
 * @returns Games matching every active filter in their original order.
 */
export function filterGamesByCategoryAndPublisher(
    gamesList: Game[],
    selectedCategories: string[],
    selectedPublisher: string = '',
): Game[] {
    return gamesList.filter((game) => {
        const categoryMatches =
            selectedCategories.length === 0 ||
            (game.category !== null && selectedCategories.includes(game.category.name));
        const publisherMatches =
            !selectedPublisher || game.publisher?.name === selectedPublisher;
        return categoryMatches && publisherMatches;
    });
}

/**
 * Load all games with their category and publisher relationships.
 *
 * @param db - Injectable Drizzle database client.
 * @returns All games ordered by title.
 */
export async function getAllGames(db: Database): Promise<Game[]> {
    const rows = await baseGamesQuery(db).orderBy(asc(games.title));
    return rows.map(mapGame);
}

/**
 * Load all game IDs in catalog display order.
 *
 * @param db - Injectable Drizzle database client.
 * @returns Game IDs ordered by title.
 */
export async function getAllGameIds(db: Database): Promise<number[]> {
    const rows = await db.select({ id: games.id }).from(games).orderBy(asc(games.title));
    return rows.map((row) => row.id);
}

/**
 * Load one game with its category and publisher relationships.
 *
 * @param db - Injectable Drizzle database client.
 * @param id - Game ID to look up.
 * @returns The matching game or null when it does not exist.
 */
export async function getGameById(db: Database, id: number): Promise<Game | null> {
    const row = await baseGamesQuery(db).where(eq(games.id, id)).get();
    return row ? mapGame(row) : null;
}
