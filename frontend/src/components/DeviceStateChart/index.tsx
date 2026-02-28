import React, { useEffect } from 'react';
import { LineChart } from '@mui/x-charts/LineChart';
import {
    Paper,
    Box,
    IconButton,
    Typography,
    CircularProgress,
    Stack,
} from '@mui/material';
import { ArrowBackIosNew, ArrowForwardIos } from '@mui/icons-material';
import { api } from '../../api/charlie';

const startDay = () => {
    const d = new Date();
    d.setHours(0);
    d.setMinutes(0);
    d.setSeconds(0);
    return d;
};

export default function HistoricalDeviceChart({ deviceId }) {
    const [loading, setLoading] = React.useState(false);
    const [data, setData] = React.useState<any[]>([]);

    const [viewRange, setViewRange] = React.useState({
        start: startDay(),
        end: new Date(),
    });

    useEffect(() => {
        api(
            `devices/${deviceId}/states?start=${viewRange.start.getTime()}&end=${viewRange.end.getTime()}`
        ).then((res) => {
            setData(
                res.data.map((r) => ({
                    timestamp: new Date(r.timestamp),
                    level: r.level,
                    power: r.power === 'on' ? 2 : r.power === 'pause' ? 1 : 0,
                }))
            );
            setLoading(false);
        });
    }, [viewRange]);

    const shiftWindow = (direction: 'left' | 'right') => {
        const shiftAmount = 2 * 60 * 60 * 1000; // 2 hours
        const multiplier = direction === 'left' ? -1 : 1;

        setViewRange((prev) => ({
            start: new Date(prev.start.getTime() + shiftAmount * multiplier),
            end: new Date(prev.end.getTime() + shiftAmount * multiplier),
        }));
    };

    return (
        <Box sx={{ width: '100%', position: 'relative' }}>
            <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                mb={2}
                px={3}
            >
                <Typography variant="h6">Data</Typography>

                <Stack direction="row" spacing={1} alignItems="center">
                    <IconButton
                        onClick={() => shiftWindow('left')}
                        disabled={loading}
                    >
                        <ArrowBackIosNew />
                    </IconButton>

                    <Typography variant="body2" sx={{ textAlign: 'center' }}>
                        {viewRange.start.toLocaleString()} -{' '}
                        {viewRange.end.toLocaleTimeString()}
                    </Typography>

                    <IconButton
                        onClick={() => shiftWindow('right')}
                        disabled={loading}
                    >
                        <ArrowForwardIos />
                    </IconButton>
                </Stack>
            </Stack>

            <Box sx={{ height: 400, width: '100%', position: 'relative' }}>
                {loading && (
                    <Box
                        sx={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 1,
                            bgcolor: 'rgba(255,255,255,0.6)',
                        }}
                    >
                        <CircularProgress />
                    </Box>
                )}

                <LineChart
                    dataset={data}
                    xAxis={[
                        {
                            dataKey: 'timestamp',
                            scaleType: 'time',
                            min: viewRange.start,
                            max: viewRange.end,
                            valueFormatter: (date) =>
                                date.toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                }),
                        },
                    ]}
                    series={[
                        {
                            dataKey: 'level',
                            label: 'Level',
                            showMark: false,
                            color: '#0288d1',
                        },
                        {
                            dataKey: 'power',
                            label: 'Power',
                            area: true,
                            curve: 'stepAfter',
                            showMark: false,
                            color: '#ed6c02',
                            valueFormatter: (v) =>
                                ['Off', 'Pause', 'On'][v as number],
                        },
                    ]}
                    skipAnimation
                />
            </Box>
        </Box>
    );
}
