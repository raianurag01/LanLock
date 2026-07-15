// Theme configuration for LanLock Mobile
export const theme = {
    colors: {
        primary: '#FF4655',      // Valorant Red
        secondary: '#0F1923',    // Valorant Dark Blue  
        background: '#0F1923',   // Dark background
        surface: '#1A242D',      // Slightly lighter surface
        accent: '#BD3944',       // Darker red accent
        text: {
            primary: '#FFFFFF',
            secondary: '#A0AEC0',
            muted: '#718096',
        },
    },
};

export const navigationTheme = {
    dark: true,
    colors: {
        primary: theme.colors.primary,
        background: theme.colors.background,
        card: theme.colors.surface,
        text: theme.colors.text.primary,
        border: theme.colors.surface,
        notification: theme.colors.primary,
    },
};
