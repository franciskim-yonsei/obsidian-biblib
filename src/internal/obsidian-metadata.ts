import type { App } from 'obsidian';

export interface MetadataWidgetRenderContext {
    app: App;
    key: string;
    onChange: (value: unknown) => void;
    sourcePath: string;
    blur: () => void;
    hoverSource: string;
}

export interface MetadataWidgetRenderer {
    focus: (direction?: string) => void;
    setValue?: (value: unknown) => void;
}

export interface MetadataTypeWidget {
    name: () => string;
    type: string;
    icon: string;
    validate: (value: unknown) => boolean;
    render: (
        containerEl: HTMLElement,
        value: unknown,
        context: MetadataWidgetRenderContext,
    ) => MetadataWidgetRenderer;
    reservedKeys?: string[];
}

export interface MetadataAssignedWidget {
    name: string;
    widget: string;
}

export interface MetadataTypeManager {
    registeredTypeWidgets: Record<string, MetadataTypeWidget>;
    assignedWidgets: Record<string, MetadataAssignedWidget>;
    trigger: (eventName: string, ...data: unknown[]) => void;
}

interface AppWithMetadataTypeManager extends App {
    metadataTypeManager: MetadataTypeManager;
}

export function getMetadataTypeManager(app: App): MetadataTypeManager {
    return (app as AppWithMetadataTypeManager).metadataTypeManager;
}
