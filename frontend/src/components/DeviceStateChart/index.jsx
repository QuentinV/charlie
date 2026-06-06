import React, { useEffect, useState } from 'react';
import { LineChart } from '@mui/x-charts/LineChart';
import {
    Box,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Typography,
    CircularProgress,
    Stack,
} from '@mui/material';
import { ArrowBackIosNew, ArrowForwardIos } from '@mui/icons-material';
import { api } from '../../api/charlie';

const startOfDay = (date = new Date()) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

const startOfHour = (date = new Date()) => {
    const d = new Date(date);
    d.setMinutes(0, 0, 0, 0);
    return d;
};

const endOfDay = (date) => {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
};

const getViewRange = (period, offset) => {
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;

    if (period === 'week') {
        const start = startOfDay(
            new Date(Date.now() - offset * 7 * dayMs - 6 * dayMs)
        );
        const end =
            offset === 0
                ? now
                : endOfDay(new Date(Date.now() - offset * 7 * dayMs));
        return { start, end };
    }

    if (period === 'month') {
        const monthStart = new Date(now);
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        monthStart.setMonth(monthStart.getMonth() - offset);

        return {
            start: monthStart,
            end:
                offset === 0
                    ? now
                    : endOfDay(
                          new Date(
                              monthStart.getFullYear(),
                              monthStart.getMonth() + 1,
                              0
                          )
                      ),
        };
    }

    const start = startOfDay(new Date(Date.now() - offset * dayMs));
    return {
        start,
        end: offset === 0 ? now : endOfDay(start),
    };
};

const PERIOD_OPTIONS = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
];

export default function HistoricalDeviceChart({
    deviceId,
    title = 'Data',
    showLevel = true,
    showPower = true,
    rangeDays = 0,
    hideToolbar = false,
    height = 400,
}) {
    const [period, setPeriod] = useState('day');
    const [periodOffset, setPeriodOffset] = useState(rangeDays);
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState([]);
    const [viewRange, setViewRange] = useState(() =>
        getViewRange(period, periodOffset)
    );

    useEffect(() => {
        setPeriodOffset(rangeDays);
    }, [rangeDays]);

    useEffect(() => {
        setViewRange(getViewRange(period, periodOffset));
    }, [period, periodOffset, deviceId]);

    const aggregateData = (rows) => {
        const normalized = rows.map((r) => ({
            timestamp: new Date(r.timestamp),
            level: r.level,
            power: r.power === 'on' ? 2 : r.power === 'pause' ? 1 : 0,
        }));

        if (period === 'day') {
            return normalized;
        }

        const buckets = new Map();
        normalized.forEach((point) => {
            const key =
                period === 'week'
                    ? startOfHour(point.timestamp).getTime()
                    : startOfDay(point.timestamp).getTime();
            const bucket = buckets.get(key) || {
                timestamp: new Date(key),
                levelSum: 0,
                count: 0,
                maxPower: 0,
            };

            bucket.levelSum += point.level;
            bucket.count += 1;
            bucket.maxPower = Math.max(bucket.maxPower, point.power);
            buckets.set(key, bucket);
        });

        return Array.from(buckets.values())
            .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
            .map((bucket) => ({
                timestamp: bucket.timestamp,
                level: bucket.levelSum / bucket.count,
                power: bucket.maxPower,
            }));
    };

    useEffect(() => {
        if (!deviceId) {
            setData([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        api(
            `devices/${deviceId}/states?start=${viewRange.start.getTime()}&end=${viewRange.end.getTime()}`
        )
            .then((res) => {
                const rows = res?.data ?? [];
                setData(aggregateData(rows));
            })
            .catch(() => {
                setData([]);
            })
            .finally(() => setLoading(false));
    }, [deviceId, viewRange]);

    const shiftWindow = (direction) => {
        setPeriodOffset((prev) =>
            Math.max(0, prev + (direction === 'left' ? 1 : -1))
        );
    };

    const series = [];
    if (showLevel) {
        series.push({
            dataKey: 'level',
            label: 'Level',
            showMark: false,
            color: '#0288d1',
        });
    }
    if (showPower) {
        series.push({
            dataKey: 'power',
            label: 'Power',
            area: true,
            curve: 'step',
            showMark: false,
            color: '#ed6c02',
            valueFormatter: (value) => ['Off', 'Pause', 'On'][value],
        });
    }

    const chartMargin = hideToolbar
        ? { left: 4, right: 4, top: 4, bottom: 8 }
        : { left: 8, right: 8, top: 12, bottom: 32 };
    const xAxisHeight = hideToolbar ? 28 : 40;
    const yAxisWidth = hideToolbar ? 24 : 32;

    return (
        <Box sx={{ width: '100%', position: 'relative' }}>
            {!hideToolbar && (
                <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                    mb={2}
                    px={3}
                >
                    <Typography variant="h6">{title}</Typography>

                    <Stack direction="row" spacing={1} alignItems="center">
                        <FormControl size="small" sx={{ minWidth: 120 }}>
                            <InputLabel id="device-state-period-label">
                                Period
                            </InputLabel>
                            <Select
                                labelId="device-state-period-label"
                                value={period}
                                label="Period"
                                onChange={(event) =>
                                    setPeriod(event.target.value)
                                }
                            >
                                {PERIOD_OPTIONS.map((option) => (
                                    <MenuItem
                                        key={option.value}
                                        value={option.value}
                                    >
                                        {option.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <IconButton
                            onClick={() => shiftWindow('left')}
                            disabled={loading}
                        >
                            <ArrowBackIosNew />
                        </IconButton>

                        <Typography
                            variant="body2"
                            sx={{ textAlign: 'center' }}
                        >
                            {viewRange.start.toLocaleString()} -{' '}
                            {viewRange.end.toLocaleString()}
                        </Typography>

                        <IconButton
                            onClick={() => shiftWindow('right')}
                            disabled={loading}
                        >
                            <ArrowForwardIos />
                        </IconButton>
                    </Stack>
                </Stack>
            )}

            <Box sx={{ height, width: '100%', position: 'relative' }}>
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

                {!deviceId ? (
                    <Box
                        sx={{
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            p: 2,
                        }}
                    >
                        <Typography color="text.secondary" align="center">
                            Select a device to show the chart.
                        </Typography>
                    </Box>
                ) : series.length === 0 ? (
                    <Box
                        sx={{
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            p: 2,
                        }}
                    >
                        <Typography color="text.secondary" align="center">
                            Toggle at least one metric to display the chart.
                        </Typography>
                    </Box>
                ) : (
                    <LineChart
                        dataset={data}
                        height={height}
                        sx={{ width: '100%', height: '100%' }}
                        margin={chartMargin}
                        xAxis={[
                            {
                                dataKey: 'timestamp',
                                scaleType: 'time',
                                min: viewRange.start,
                                max: viewRange.end,
                                height: xAxisHeight,
                                tickLabelMinGap: 6,
                                tickLabelStyle: { fontSize: 10 },
                                valueFormatter: (date) => {
                                    if (period === 'month') {
                                        return date.toLocaleDateString([], {
                                            month: 'short',
                                            day: 'numeric',
                                        });
                                    }
                                    if (period === 'week') {
                                        return date.toLocaleString([], {
                                            weekday: 'short',
                                            hour: '2-digit',
                                        });
                                    }
                                    return date.toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    });
                                },
                            },
                        ]}
                        yAxis={[
                            {
                                width: yAxisWidth,
                                tickLabelStyle: { fontSize: 10 },
                            },
                        ]}
                        series={series}
                        skipAnimation
                    />
                )}
            </Box>
        </Box>
    );
}
