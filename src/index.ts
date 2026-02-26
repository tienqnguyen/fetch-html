import { marked } from 'marked';

// Function to strip HTML tags and extract text content
function stripHtmlTags(input: string): string {
    const regex = /<[^>]*>/g;
    return input.replace(regex, '');
}

// Function to convert HTML to Markdown
function convertHtmlToMarkdown(html: string): string {
    return marked(html);
}

// Main handler function
export function processHtml(htmlContent: string, options: { markdown?: boolean; regex?: string } = {}): string {
    if (options.markdown) {
        return convertHtmlToMarkdown(htmlContent);
    } else if (options.regex) {
        const plainText = stripHtmlTags(htmlContent);
        const regexPattern = new RegExp(options.regex, 'g');
        return plainText.match(regexPattern)?.join('\n') || '';
    } else {
        return stripHtmlTags(htmlContent);
    }
}

// Example usage
const htmlString = '<div>Hello <strong>World</strong></div>';
console.log('Plain text:', stripHtmlTags(htmlString));
console.log('Markdown:', convertHtmlToMarkdown(htmlString));