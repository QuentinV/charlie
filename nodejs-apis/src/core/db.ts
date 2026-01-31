import dbMapping from './db_mapping.json';
import { MongoClient } from 'mongodb';

let db: any = null;

const getDb = async () => {
    const host = process.env.DB_HOST ?? 'db:27017';
    if (!host) throw Error('DB HOST missing');
    const url = `mongodb://${host}`;
    const dbName = 'charlie';
    const client = new MongoClient(url);

    try {
        await client.connect();
        return client.db(dbName);
    } catch (error) {
        console.error('Error:', error);
    }
};

const dbCollection = async (collec: string) => {
    if (!db) {
        db = await getDb();
    }

    return db.collection(collec);
};

export const cs: { [key: string]: any } = {};
export const init = async () => {
    const dbm: any = dbMapping;
    for (const k in dbm) {
        console.log('[DB init]', k);
        cs[k] = await dbCollection(dbm[k]);
    }
};
