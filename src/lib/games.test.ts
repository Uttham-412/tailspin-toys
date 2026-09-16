import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../db/test-helpers';
import { categories, publishers, games } from '../../db/schema';
import type { Database } from './db';
import {
    getAllGames,
    getAllGameIds,
    getGameById,
    getGamesByPublisherId,
    getPublisherById,
    matchesGameQuery,
    filterGamesByQuery,
    filterGamesByCategoryAndPublisher,
    sortGames,
} from './games';
import type { Game } from '../types/game';

async function seedGames(db: Database, count: number): Promise<void> {
    const [strategyCategory] = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'cat' })
        .returning({ id: categories.id });
    const [puzzleCategory] = await db
        .insert(categories)
        .values({ name: 'Puzzle', description: 'cat' })
        .returning({ id: categories.id });
    const [publisher] = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'pub' })
        .returning({ id: publishers.id });

    // Insert titles in reverse-alphabetical order to prove ordering is applied.
    for (let i = count; i >= 1; i--) {
        await db.insert(games).values({
            title: `Game ${String(i).padStart(2, '0')}`,
            description: `Description ${i}`,
            starRating: 4.2,
            categoryId: i === count ? puzzleCategory.id : strategyCategory.id,
            publisherId: publisher.id,
        });
    }
}

describe('games data-access helpers', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    it('returns all games ordered by title', async () => {
        await seedGames(db, 3);
        const all = await getAllGames(db);
        expect(all.map((g) => g.title)).toEqual(['Game 01', 'Game 02', 'Game 03']);
        expect(all[0].category).toEqual({ id: expect.any(Number), name: 'Strategy', description: 'cat' });
        expect(all[0].publisher).toEqual({ id: expect.any(Number), name: 'Pub One', description: 'pub' });
    });

    it('returns all game ids ordered by title', async () => {
        await seedGames(db, 3);
        const ids = await getAllGameIds(db);
        const all = await getAllGames(db);
        expect(ids).toEqual(all.map((g) => g.id));
    });

    it('fetches a single game by id', async () => {
        await seedGames(db, 2);
        const ids = await getAllGameIds(db);
        const game = await getGameById(db, ids[0]);
        expect(game?.title).toBe('Game 01');
    });

    it('returns null for a non-existent game', async () => {
        await seedGames(db, 2);
        expect(await getGameById(db, 99999)).toBeNull();
    });

    it('matches fuzzy search queries across titles, categories, publishers, and descriptions', async () => {
        await seedGames(db, 3);
        const gamesList = await getAllGames(db);
        const game = gamesList[0];

        expect(matchesGameQuery(game, 'gme 01')).toBe(true);
        expect(matchesGameQuery(game, 'strat')).toBe(true);
        expect(matchesGameQuery(game, 'pub')).toBe(true);
        expect(matchesGameQuery(game, 'desc 1')).toBe(true);
        expect(matchesGameQuery(game, 'totally missing')).toBe(false);
        expect(filterGamesByQuery(gamesList, 'gme 01')).toHaveLength(1);
    });

    it('filters by one or more categories and an optional publisher', async () => {
        await seedGames(db, 3);
        const gamesList = await getAllGames(db);

        expect(filterGamesByCategoryAndPublisher(gamesList, ['Puzzle'])).toHaveLength(1);
        expect(filterGamesByCategoryAndPublisher(gamesList, ['Strategy', 'Puzzle'])).toHaveLength(3);
        expect(filterGamesByCategoryAndPublisher(gamesList, [], 'Pub One')).toHaveLength(3);
        expect(filterGamesByCategoryAndPublisher(gamesList, ['Puzzle'], 'Pub One')).toHaveLength(1);
        expect(filterGamesByCategoryAndPublisher(gamesList, ['Puzzle'], 'Missing Publisher')).toHaveLength(0);
    });

    it('returns a publisher and its games with descriptions', async () => {
        await seedGames(db, 3);
        const publisher = await getPublisherById(db, 1);

        expect(publisher).toEqual({ id: 1, name: 'Pub One', description: 'pub' });
        const publisherGames = await getGamesByPublisherId(db, 1);
        expect(publisherGames).toHaveLength(3);
        expect(publisherGames[0].publisher?.description).toBe('pub');
    });

    it('sorts titles in both directions and puts unrated games last for rating order', () => {
        const gamesList: Game[] = [
            { id: 1, title: 'Bravo', description: '', starRating: null, category: null, publisher: null },
            { id: 2, title: 'Alpha', description: '', starRating: 4.1, category: null, publisher: null },
            { id: 3, title: 'Charlie', description: '', starRating: 4.8, category: null, publisher: null },
        ];

        expect(sortGames(gamesList, 'title-asc').map((game) => game.title)).toEqual(['Alpha', 'Bravo', 'Charlie']);
        expect(sortGames(gamesList, 'title-desc').map((game) => game.title)).toEqual(['Charlie', 'Bravo', 'Alpha']);
        expect(sortGames(gamesList, 'rating-desc').map((game) => game.title)).toEqual(['Charlie', 'Alpha', 'Bravo']);
        expect(gamesList[0].title).toBe('Bravo');
    });
});
