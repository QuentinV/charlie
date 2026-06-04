import { useCallback, useEffect, useState } from 'react';
import './index.css';
import { api } from '../../api/charlie';

async function fetchActivities({ type, from, limit = 20, first = 0 }) {
    const params = new URLSearchParams();

    if (type) params.append('type', type);
    if (from) params.append('from', from);
    params.append('limit', String(limit));
    params.append('first', String(first));

    return api(`activities?${params.toString()}`);
}

export default function LogViewer() {
    const [logs, setLogs] = useState([]);
    const [total, setTotal] = useState(0);
    const [filters, setFilters] = useState({
        type: '',
        from: '',
    });
    const [pagination, setPagination] = useState({
        limit: 30,
        first: 0,
    });
    const [expanded, setExpanded] = useState(null);

    const loadLogs = useCallback(
        async (pag, reset = false) => {
            setPagination(pag);
            const res = await fetchActivities({
                ...filters,
                ...pag,
            });

            setTotal(res.total);

            if (reset) {
                setLogs(res.data);
            } else {
                setLogs((prev) => [...prev, ...res.data]);
            }
        },
        [filters, setPagination]
    );

    useEffect(() => {
        loadLogs({ limit: 30, first: 0 }, true);
    }, [filters]);

    const handleLoadMore = () => {
        loadLogs({ ...pagination, first: pagination.first + pagination.limit });
    };

    const toggleExpand = (id) => {
        setExpanded((prev) => (prev === id ? null : id));
    };

    return (
        <div className="log-container">
            <div className="filters">
                <select
                    value={filters.type}
                    onChange={(e) =>
                        setFilters((prev) => ({
                            ...prev,
                            type: e.target.value,
                        }))
                    }
                >
                    <option value="">Type: All</option>
                    <option value="log">log</option>
                    <option value="echo">echo</option>
                </select>
                <select
                    value={filters.from}
                    onChange={(e) =>
                        setFilters((prev) => ({
                            ...prev,
                            from: e.target.value,
                        }))
                    }
                >
                    <option value="">From: All</option>
                    <option value="ECHO">echo</option>
                    <option value="devices">devices</option>
                    <option value="devices-actions">devices-actions</option>
                    <option value="nlu">nlu</option>
                    <option value="MQTT">MQTT</option>
                </select>
            </div>
            <div className="log-list">
                {logs.map((log) => {
                    const isOpen = expanded === log._id;

                    return (
                        <div
                            key={log._id}
                            className={`log-row ${isOpen ? 'expanded' : ''}`}
                            onClick={() => toggleExpand(log._id)}
                        >
                            <div className="log-meta">
                                <span className={`badge badge-${log.type}`}>
                                    {log.type.toUpperCase()}
                                </span>

                                <span className="timestamp">
                                    {new Date(log.modified).toLocaleString()}
                                </span>

                                <span className="from">{log.from}</span>

                                <span className="message">{log.message}</span>
                            </div>

                            {isOpen && (
                                <pre className="json-block">
                                    {JSON.stringify(log, null, 2)}
                                </pre>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Load More */}
            {logs.length < total && (
                <button className="load-more" onClick={handleLoadMore}>
                    Load More
                </button>
            )}
        </div>
    );
}
