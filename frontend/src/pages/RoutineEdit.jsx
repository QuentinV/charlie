import React from 'react';
import { RoutineConfig } from '../components/Routines/RoutineConfig';
import { useParams } from 'react-router-dom';

export const RoutineEditPage = () => {
    const { id } = useParams();

    return (
        <>
            <RoutineConfig id={id ?? ''} />
        </>
    );
};
