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

export const EchoChangelogs = ({ data }) => {
    return (
        <Box>
            <Timeline position="right">
                {data.map((release, index) => (
                    <TimelineItem key={release.version}>
                        {/* Left side: Version Number */}
                        <TimelineOppositeContent
                            sx={{ m: 'auto 0', flex: 0.2 }}
                            align="right"
                            variant="body2"
                            color="text.secondary"
                        >
                            v{release.version}
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
