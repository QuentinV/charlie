import 'dotenv/config';
import { v4 as uuidV4 } from 'uuid';

(async () => {
    /*const id = uuidV4();
    await fetch('http://192.168.1.84:50030/api/v0/searches', {
        method: 'POST',
        body: JSON.stringify({
            id,
            searchText: 'grand corps malade',
        }),
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.SLSKD_API_KEY}`,
        },
    });*/
    const id = '0e167111-20c9-40b3-9276-423a9e32af41';

    const res = await (
        await fetch(`http://192.168.1.84:50030/api/v0/searches/${id}`, {
            headers: {
                Authorization: `Bearer ${process.env.SLSKD_API_KEY}`,
            },
        })
    ).json();

    if (res.isComplete) {
        const data = await (
            await fetch(
                `http://192.168.1.84:50030/api/v0/searches/${id}/responses`,
                {
                    headers: {
                        Authorization: `Bearer ${process.env.SLSKD_API_KEY}`,
                    },
                }
            )
        ).json();

        console.log(data[0]);
    }
})();
