import { marked } from 'marked'; // Assumes that a markdown library is available

// Updated function to strip HTML tags and extract text content.
function stripHtmlTags(input) {
    // Regular expression that matches HTML tags
    const regex = /<[^>]*>/g;
    // Replace HTML tags with an empty string
    return input.replace(regex, '');
}

// Function to convert HTML to Markdown
function convertHtmlToMarkdown(html: string): string {
    return marked(html);
}

// Existing logic to handle parameters
const urlParams = new URLSearchParams(window.location.search);
const markdownParam = urlParams.get('markdown');
const regexParam = urlParams.get('regex');

// Your existing handling logic
if (markdownParam === 'true') {
    const html = /* code to fetch or get the HTML content */;
    const markdown = convertHtmlToMarkdown(html);
    // Return or display the markdown content as needed
} else if (regexParam) {
    // Existing regex functionality
    const textContent = stripHtmlTags(html);
    console.log(textContent); // Output: 'Hello World'
}

// Example usage
const htmlString = '<div>Hello <strong>World</strong></div>';
const textContent = stripHtmlTags(htmlString);
console.log(textContent); // Output: 'Hello World'