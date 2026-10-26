import React from 'react';
import { Box, Typography, Card, CardContent, Chip, Stack } from '@mui/material';
import {
    Timeline,
    TimelineItem,
    TimelineSeparator,
    TimelineConnector,
    TimelineContent,
    TimelineDot,
    TimelineOppositeContent,
} from '@mui/lab';
import UpdateIcon from '@mui/icons-material/Update';

/**
 * Release notes of the echo firmware. An entry is identified by the date it
 * was released, or by its version for the entries that predate the date field.
 */
export const EchoChangelogs = ({ data }) => {
    // Newest first; sort() is stable so the entries without a date keep the
    // order of the file.
    const releases = [...(data ?? [])].sort((a, b) =>
        a.date && b.date ? b.date.localeCompare(a.date) : 0
    );

    return (
        <Box>
            <Timeline position="right">
                {releases.map((release, index) => (
                    <TimelineItem key={release.date ?? release.version}>
                        {/* Left side: Version Number */}
                        <TimelineOppositeContent
                            sx={{ m: 'auto 0', flex: 0.2 }}
                            align="right"
                            variant="body2"
                            color="text.secondary"
                        >
                            {release.date ?? `v${release.version}`}
                        </TimelineOppositeContent>

                        {/* Middle: The Line and Dot */}
                        <TimelineSeparator>
                            <TimelineConnector
                                sx={{ bgcolor: 'primary.main' }}
                            />
                            <TimelineDot
                                color="primary"
                                variant={index === 0 ? 'filled' : 'outlined'}
                            >
                                <UpdateIcon fontSize="small" />
                            </TimelineDot>
                            <TimelineConnector />
                        </TimelineSeparator>

                        {/* Right side: Content Card */}
                        <TimelineContent sx={{ p: 0.5 }}>
                            <Card
                                variant="outlined"
                                sx={{ boxShadow: 1, p: 1 }}
                            >
                                <Typography
                                    color="text.secondary"
                                    sx={{ mb: 1 }}
                                >
                                    {release.description}
                                </Typography>

                                <Stack
                                    direction="row"
                                    spacing={1}
                                    flexWrap="wrap"
                                    useFlexGap
                                >
                                    {release.devices.map((device) => (
                                        <Chip
                                            key={device}
                                            label={device}
                                            size="small"
                                            variant="soft"
                                            color="secondary"
                                            sx={{ fontSize: '0.7rem' }}
                                        />
                                    ))}
                                </Stack>
                            </Card>
                        </TimelineContent>
                    </TimelineItem>
                ))}
            </Timeline>
        </Box>
    );
};
