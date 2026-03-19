import { FunctionComponent, PropsWithChildren } from "react";
import "./page.css";

interface PageContianerProps {
    title: string,
}

export const PageContianer: FunctionComponent<PropsWithChildren<PageContianerProps>> = ({
    title,
    children
}) => {
    return (
        <div className="page-container">
            <h1>{title}</h1>
            {children}
        </div>
    );
};
