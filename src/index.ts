// Updated function to strip HTML tags and extract text content.
function stripHtmlTags(input) {
    // Regular expression that matches HTML tags
    const regex = /<[^>]*>/g;
    // Replace HTML tags with an empty string
    return input.replace(regex, '');
}

// Example usage
const htmlString = '<div>Hello <strong>World</strong></div>';
const textContent = stripHtmlTags(htmlString);
console.log(textContent); // Output: 'Hello World'
